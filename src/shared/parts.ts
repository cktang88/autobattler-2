// Part catalog: 10 chassis, 10 mobility systems, 18 mount modules.
// Balance numbers live here; stats.ts turns a Design into UnitStats.

import type { ChassisDef, MobilityDef, ModuleDef, MountClass } from './types.ts';

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

export const MODULES: ModuleDef[] = [
  // ---- Light ----
  { id: 'mg', name: 'Machine Gun', desc: 'Rapid fire. Shreds light units and aircraft; weak vs armor.', mount: 'L', kind: 'weapon', weight: 1, cost: 10,
    damage: 9, cooldown: 0.15, range: 4.5, targetsGround: true, targetsAir: true, projectile: 'bullet', projectileSpeed: 22, ap: 0, spread: 0.25 },
  { id: 'laser', name: 'Pulse Laser', desc: 'Accurate hitscan pulses with some armor pierce.', mount: 'L', kind: 'weapon', weight: 1.2, cost: 18,
    damage: 24, cooldown: 0.6, range: 5.5, targetsGround: true, targetsAir: true, projectile: 'beam', ap: 0.3 },
  { id: 'flamer', name: 'Flamethrower', desc: 'Short-range cone that ignores most armor.', mount: 'L', kind: 'weapon', weight: 1.5, cost: 15,
    damage: 7, cooldown: 0.1, range: 2.5, targetsGround: true, targetsAir: false, projectile: 'flame', projectileSpeed: 9, splash: 0.8, ap: 0.8 },
  { id: 'repair', name: 'Repair Beam', desc: 'Heals the most damaged ally in range.', mount: 'L', kind: 'utility', weight: 1, cost: 20,
    heal: 22, range: 4 },
  { id: 'plateL', name: 'Armor Plate', desc: '+3 armor, +60 hp.', mount: 'L', kind: 'armor', weight: 2, cost: 8, armor: 3, hp: 60 },
  // ---- Medium ----
  { id: 'autocannon', name: 'Autocannon', desc: 'Versatile mid-caliber gun. Hits ground and air.', mount: 'M', kind: 'weapon', weight: 3, cost: 30,
    damage: 32, cooldown: 0.5, range: 6, targetsGround: true, targetsAir: true, projectile: 'bullet', projectileSpeed: 18, splash: 0.3, ap: 0.3, spread: 0.3 },
  { id: 'flak', name: 'Flak Cannon', desc: 'Anti-air only. Bursting shells wreck aircraft groups.', mount: 'M', kind: 'weapon', weight: 3, cost: 26,
    damage: 45, cooldown: 0.9, range: 7.5, targetsGround: false, targetsAir: true, projectile: 'shell', projectileSpeed: 16, splash: 1.3, ap: 0.2, airBonus: 1.5 },
  { id: 'rockets', name: 'Rocket Pod', desc: 'Salvo of 4 unguided rockets with splash.', mount: 'M', kind: 'weapon', weight: 3, cost: 34,
    damage: 42, cooldown: 4, burst: 4, range: 7, targetsGround: true, targetsAir: false, projectile: 'rocket', projectileSpeed: 11, splash: 1, ap: 0.2, spread: 0.6 },
  { id: 'sam', name: 'Missile Rack', desc: 'Homing missiles. Long range, bonus vs aircraft.', mount: 'M', kind: 'weapon', weight: 3, cost: 38,
    damage: 85, cooldown: 3, range: 9, targetsGround: true, targetsAir: true, projectile: 'missile', projectileSpeed: 9, splash: 0.4, ap: 0.5, airBonus: 1.6 },
  { id: 'tesla', name: 'Tesla Coil', desc: 'Lightning arcs that jump between up to 4 enemies.', mount: 'M', kind: 'weapon', weight: 3.5, cost: 34,
    damage: 48, cooldown: 1.2, range: 4, targetsGround: true, targetsAir: true, projectile: 'lightning', chain: 3, ap: 0.4 },
  { id: 'mortar', name: 'Mortar', desc: 'Lobbed shells over the front line. Minimum range 3.', mount: 'M', kind: 'weapon', weight: 3.5, cost: 34,
    damage: 60, cooldown: 3, range: 10, minRange: 3, targetsGround: true, targetsAir: false, projectile: 'arc', projectileSpeed: 7, splash: 1.2, ap: 0.2, spread: 0.8 },
  { id: 'shield', name: 'Shield Projector', desc: 'Personal energy shield that absorbs 260 damage and regenerates.', mount: 'M', kind: 'utility', weight: 2.5, cost: 32, shield: 260 },
  { id: 'plateM', name: 'Composite Armor', desc: '+6 armor, +150 hp.', mount: 'M', kind: 'armor', weight: 5, cost: 20, armor: 6, hp: 150 },
  // ---- Heavy ----
  { id: 'cannon', name: 'Heavy Cannon', desc: 'Armor-piercing shells. The tank killer.', mount: 'H', kind: 'weapon', weight: 8, cost: 60,
    damage: 190, cooldown: 2.2, range: 7, targetsGround: true, targetsAir: false, projectile: 'shell', projectileSpeed: 20, splash: 0.3, ap: 0.7, spread: 0.2 },
  { id: 'railgun', name: 'Railgun', desc: 'Pierces everything in a line. Extreme range.', mount: 'H', kind: 'weapon', weight: 9, cost: 85,
    damage: 320, cooldown: 4.5, range: 12, targetsGround: true, targetsAir: true, projectile: 'rail', ap: 1, pierce: true },
  { id: 'howitzer', name: 'Howitzer', desc: 'Long-range artillery with huge splash. Minimum range 5.', mount: 'H', kind: 'weapon', weight: 10, cost: 80,
    damage: 150, cooldown: 5, range: 16, minRange: 5, targetsGround: true, targetsAir: false, projectile: 'arc', projectileSpeed: 8, splash: 2, ap: 0.3, spread: 1.2 },
  { id: 'plasma', name: 'Plasma Lance', desc: 'Searing short-range beam with heavy armor pierce.', mount: 'H', kind: 'weapon', weight: 8, cost: 70,
    damage: 48, cooldown: 0.25, range: 5, targetsGround: true, targetsAir: true, projectile: 'beam', ap: 0.6 },
  { id: 'plateH', name: 'Heavy Armor', desc: '+10 armor, +400 hp.', mount: 'H', kind: 'armor', weight: 12, cost: 35, armor: 10, hp: 400 },
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
