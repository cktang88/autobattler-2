// src/shared/grid.ts
var METERS_PER_CELL = 5;
var FIELD_W = 48;
var FIELD_H = 46;
var DEPLOY_W = FIELD_W;
var DEPLOY_D = 12;
function localToWorldCell(side2, x, y, size) {
  if (side2 === 0) return { col: x, row: FIELD_H - DEPLOY_D + y };
  return { col: FIELD_W - x - size, row: DEPLOY_D - y - size };
}
function placementCenter(side2, p, size) {
  const { col, row } = localToWorldCell(side2, p.x, p.y, size);
  return { x: col + size / 2, y: row + size / 2 };
}
var forwardY = (side2) => side2 === 0 ? -1 : 1;
function inDeployZone(x, y, size) {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x + size <= DEPLOY_W && y + size <= DEPLOY_D;
}
function overlaps(ax, ay, as, bx, by, bs) {
  return ax < bx + bs && bx < ax + as && ay < by + bs && by < ay + as;
}

// src/shared/parts.ts
var CHASSIS = [
  { id: "scout", name: "Scout Frame", desc: "Tiny, cheap and quick. One light mount.", size: 1, hp: 140, armor: 0, weight: 3, cost: 25, mounts: ["L"], traits: [], shape: "wedge" },
  { id: "drone", name: "Drone Core", desc: "Featherweight core. Pairs well with rotors and jets.", size: 1, hp: 90, armor: 0, weight: 1.5, cost: 20, mounts: ["L"], traits: ["compact"], shape: "pod" },
  { id: "raider", name: "Raider Frame", desc: "Light skirmisher with twin light mounts.", size: 1, hp: 210, armor: 2, weight: 5, cost: 45, mounts: ["L", "L"], traits: [], shape: "box" },
  { id: "warden", name: "Warden Hull", desc: "Sturdy medium hull built to hold a line.", size: 2, hp: 560, armor: 6, weight: 14, cost: 100, mounts: ["M", "L"], traits: [], shape: "hex" },
  { id: "striker", name: "Striker Frame", desc: "Aggressive medium frame with three mounts.", size: 2, hp: 430, armor: 4, weight: 12, cost: 115, mounts: ["M", "M", "L"], traits: [], shape: "cross" },
  { id: "longarm", name: "Longarm Platform", desc: "Stabilized platform: one heavy mount, +20% weapon range.", size: 2, hp: 360, armor: 3, weight: 12, cost: 105, mounts: ["H"], traits: ["rangeBoost"], shape: "long" },
  { id: "aegis", name: "Aegis Frame", desc: "Support frame. Field-repairs nearby allies.", size: 2, hp: 470, armor: 4, weight: 13, cost: 135, mounts: ["M", "L"], traits: ["repairAura"], shape: "round" },
  { id: "gunship", name: "Gunship Airframe", desc: "Aerodynamic hull. Must fly: rotors or jets only.", size: 2, hp: 380, armor: 3, weight: 8, cost: 120, mounts: ["M", "M"], traits: ["airOnly"], shape: "airframe" },
  { id: "bastion", name: "Bastion Hull", desc: "Massive armored hull. Slow, nearly unbreakable.", size: 3, hp: 1500, armor: 14, weight: 38, cost: 240, mounts: ["H", "M", "M"], traits: [], shape: "fortress" },
  { id: "colossus", name: "Colossus Frame", desc: "Walking arsenal with four mounts.", size: 3, hp: 1250, armor: 10, weight: 34, cost: 280, mounts: ["H", "H", "M", "L"], traits: [], shape: "titan" }
];
var MOBILITY = [
  { id: "wheels", name: "Wheels", desc: "Fast and cheap, but fragile and light-duty.", kind: "ground", sizes: [1, 2], speed: 3.2, turn: 4, capacity: [8, 24, 0], weight: 1.5, hp: 0, armor: 0, cost: 8, traits: [] },
  { id: "halftrack", name: "Half-Track", desc: "Wheels up front, treads behind. Balanced all-rounder.", kind: "ground", sizes: [1, 2, 3], speed: 2.3, turn: 2.6, capacity: [9, 27, 52], weight: 2.5, hp: 30, armor: 1, cost: 14, traits: [] },
  { id: "treads", name: "Tank Treads", desc: "Heavy-duty treads. Slow, tough, carries anything.", kind: "ground", sizes: [2, 3], speed: 1.6, turn: 1.8, capacity: [0, 32, 66], weight: 4, hp: 60, armor: 3, cost: 22, traits: ["crush"] },
  { id: "legs", name: "Bipedal Legs", desc: "Nimble walker. Fires while moving.", kind: "ground", sizes: [1, 2], speed: 2, turn: 3.5, capacity: [9, 24, 0], weight: 2, hp: 20, armor: 0, cost: 14, traits: ["fireOnMove"] },
  { id: "spider", name: "Spider Legs", desc: "Six-legged stable walker. Better accuracy, carries heavy loads.", kind: "ground", sizes: [1, 2, 3], speed: 1.6, turn: 3, capacity: [10, 29, 58], weight: 3.5, hp: 40, armor: 2, cost: 22, traits: ["stable"] },
  { id: "jumpjets", name: "Jump Legs", desc: "Leaps over obstacles straight into the fight.", kind: "ground", sizes: [1, 2], speed: 2, turn: 3, capacity: [8, 21, 0], weight: 2.5, hp: 10, armor: 0, cost: 22, traits: ["leap"] },
  { id: "hover", name: "Hover Skirt", desc: "Skims the ground. Very fast, hard to hit.", kind: "ground", sizes: [1, 2], speed: 3.6, turn: 2.2, capacity: [6, 17, 0], weight: 1.5, hp: 0, armor: 0, cost: 18, traits: ["evasive"] },
  { id: "rotor", name: "Rotor", desc: "Helicopter rotors. Flies over ground units; only anti-air can hit it.", kind: "air", sizes: [1, 2], speed: 2.8, turn: 3, capacity: [5, 17, 0], weight: 2, hp: 0, armor: 0, cost: 28, traits: ["fireOnMove"] },
  { id: "jet", name: "Jet Thrusters", desc: "Very fast strafing flyer. Fires on the pass.", kind: "air", sizes: [1, 2], speed: 4.6, turn: 1.6, capacity: [4, 14, 0], weight: 1.5, hp: 0, armor: 0, cost: 32, traits: ["fireOnMove", "strafe", "evasive"] },
  { id: "anchor", name: "Anchor Mount", desc: "Immobile emplacement. Extra hp, armor and +15% range.", kind: "static", sizes: [1, 2, 3], speed: 0, turn: 2.5, capacity: [14, 40, 80], weight: 0, hp: 100, armor: 4, cost: 0, traits: ["fortified"] }
];
var G = { targetsGround: true, targetsAir: false };
var A = { targetsGround: false, targetsAir: true };
var GA = { targetsGround: true, targetsAir: true };
var MELEE = { targetsGround: true, targetsAir: false, projectile: "melee" };
var util = (m) => ({ kind: "utility", ...m });
var wpn = (m) => ({ kind: "weapon", ...m });
var MODULES = [
  // ---------------- Machine guns ----------------
  wpn({
    id: "mg",
    name: "7.62mm Machine Gun",
    family: "7.62mm",
    desc: "Rapid fire. Shreds light units and aircraft; weak vs armor.",
    category: "machinegun",
    visual: "gun",
    caliber: 0.2,
    mount: "L",
    weight: 1,
    cost: 6,
    damage: 9,
    cooldown: 0.15,
    range: 4.5,
    ...GA,
    projectile: "bullet",
    projectileSpeed: 22,
    ap: 0,
    spread: 0.35
  }),
  wpn({
    id: "twinmg",
    name: "Twin 7.62mm MG",
    family: "Twin 7.62mm",
    desc: "Two coaxial machine guns on one mount. Double the lead.",
    category: "machinegun",
    visual: "gun",
    barrels: 2,
    caliber: 0.2,
    mount: "L",
    weight: 1.8,
    cost: 11,
    damage: 9,
    cooldown: 0.075,
    range: 4.5,
    ...GA,
    projectile: "bullet",
    projectileSpeed: 22,
    ap: 0,
    spread: 0.45
  }),
  wpn({
    id: "hmg",
    name: "12.7mm Heavy MG",
    family: "12.7mm",
    desc: "Heavier rounds with a little armor pierce and reach.",
    category: "machinegun",
    visual: "gun",
    caliber: 0.4,
    mount: "L",
    weight: 1.6,
    cost: 10,
    damage: 16,
    cooldown: 0.22,
    range: 5,
    ...GA,
    magazine: 25,
    reload: 2.5,
    projectile: "bullet",
    projectileSpeed: 24,
    ap: 0.15,
    spread: 0.3
  }),
  wpn({
    id: "minigun",
    name: "Rotary Minigun",
    family: "Rotary",
    desc: "Six spinning barrels. A wall of bullets at close range.",
    category: "machinegun",
    visual: "gatling",
    barrels: 6,
    caliber: 0.5,
    mount: "M",
    weight: 3,
    cost: 22,
    damage: 8,
    cooldown: 0.04,
    range: 5,
    ...GA,
    projectile: "bullet",
    projectileSpeed: 24,
    ap: 0,
    spread: 0.65
  }),
  wpn({
    id: "shotgun",
    name: "Scattergun",
    family: "Scatter",
    desc: "Six-pellet blasts. Brutal up close, useless far away.",
    category: "machinegun",
    visual: "shotgun",
    caliber: 0.5,
    mount: "L",
    weight: 1.4,
    cost: 9,
    damage: 12,
    pellets: 6,
    cooldown: 1,
    range: 3,
    ...GA,
    projectile: "bullet",
    projectileSpeed: 20,
    ap: 0.1,
    spread: 0.9
  }),
  // ---------------- Autocannons ----------------
  wpn({
    id: "ac20",
    name: "20mm Autocannon",
    family: "20mm",
    desc: "Light autocannon. Small explosive rounds.",
    category: "autocannon",
    visual: "gun",
    caliber: 0.55,
    mount: "L",
    weight: 1.8,
    cost: 14,
    damage: 18,
    cooldown: 0.2,
    range: 5.5,
    ...GA,
    magazine: 10,
    reload: 2,
    projectile: "bullet",
    projectileSpeed: 20,
    splash: 0.2,
    ap: 0.2,
    spread: 0.3
  }),
  wpn({
    id: "autocannon",
    name: "30mm Autocannon",
    family: "30mm",
    desc: "Versatile mid-caliber gun. Hits ground and air.",
    category: "autocannon",
    visual: "gun",
    caliber: 0.5,
    mount: "M",
    weight: 3,
    cost: 22,
    damage: 32,
    cooldown: 0.3,
    range: 6,
    ...GA,
    magazine: 6,
    reload: 2,
    projectile: "bullet",
    projectileSpeed: 18,
    splash: 0.3,
    ap: 0.3,
    spread: 0.3
  }),
  wpn({
    id: "twin30",
    name: "Twin 30mm Autocannon",
    family: "Twin 30mm",
    desc: "Two 30mm guns on one mount: double firepower, heavier and pricier.",
    category: "autocannon",
    visual: "gun",
    barrels: 2,
    caliber: 0.5,
    mount: "M",
    weight: 5,
    cost: 38,
    damage: 32,
    cooldown: 0.15,
    range: 6,
    ...GA,
    magazine: 12,
    reload: 2.4,
    projectile: "bullet",
    projectileSpeed: 18,
    splash: 0.3,
    ap: 0.3,
    spread: 0.35
  }),
  wpn({
    id: "ac40",
    name: "40mm Bofors",
    family: "40mm",
    desc: "Long-reach autocannon with proximity rounds, deadly to aircraft.",
    category: "autocannon",
    visual: "gun",
    caliber: 0.8,
    mount: "M",
    weight: 4,
    cost: 28,
    damage: 55,
    cooldown: 0.5,
    range: 7.5,
    ...GA,
    magazine: 4,
    reload: 2.5,
    projectile: "bullet",
    projectileSpeed: 20,
    splash: 0.5,
    ap: 0.3,
    spread: 0.3,
    airBonus: 1.3
  }),
  wpn({
    id: "quad20",
    name: "Quad 20mm AA",
    family: "Quad 20mm",
    desc: "Four 20mm barrels slaved to an AA director. Air only.",
    category: "autocannon",
    visual: "gun",
    barrels: 4,
    caliber: 0.45,
    mount: "M",
    weight: 4,
    cost: 26,
    damage: 18,
    cooldown: 0.05,
    range: 6.5,
    ...A,
    magazine: 24,
    reload: 3,
    projectile: "bullet",
    projectileSpeed: 24,
    splash: 0.2,
    ap: 0.2,
    spread: 0.3,
    airBonus: 1.4
  }),
  // ---------------- Cannons ----------------
  wpn({
    id: "cannon75",
    name: "75mm Gun",
    family: "75mm",
    desc: "Medium tank gun. Solid armor pierce on a medium mount.",
    category: "cannon",
    visual: "cannon",
    caliber: 0.5,
    mount: "M",
    weight: 5,
    cost: 32,
    damage: 95,
    cooldown: 0.7,
    range: 6.5,
    ...G,
    magazine: 3,
    reload: 4,
    projectile: "shell",
    projectileSpeed: 20,
    splash: 0.3,
    ap: 0.55,
    spread: 0.2
  }),
  wpn({
    id: "cannon",
    name: "120mm Heavy Cannon",
    family: "120mm",
    desc: "Armor-piercing shells. The tank killer.",
    category: "cannon",
    visual: "cannon",
    caliber: 0.8,
    mount: "H",
    weight: 8,
    cost: 50,
    damage: 190,
    cooldown: 2.2,
    range: 7,
    ...G,
    projectile: "shell",
    projectileSpeed: 20,
    splash: 0.3,
    ap: 0.7,
    spread: 0.2
  }),
  wpn({
    id: "twin120",
    name: "Twin 120mm Cannon",
    family: "Twin 120mm",
    desc: "Two heavy cannons in one turret. Twice the punch, huge weight.",
    category: "cannon",
    visual: "cannon",
    barrels: 2,
    caliber: 0.8,
    mount: "H",
    weight: 13,
    cost: 85,
    damage: 190,
    cooldown: 1.1,
    range: 7,
    ...G,
    projectile: "shell",
    projectileSpeed: 20,
    splash: 0.3,
    ap: 0.7,
    spread: 0.25
  }),
  wpn({
    id: "gauss",
    name: "Gauss Cannon",
    family: "Gauss",
    desc: "Magnetic slug that punches through every unit in its path.",
    category: "cannon",
    visual: "gauss",
    caliber: 0.8,
    mount: "H",
    weight: 10,
    cost: 75,
    damage: 240,
    cooldown: 2.6,
    range: 9,
    ...GA,
    projectile: "shell",
    projectileSpeed: 34,
    pierce: true,
    ap: 0.8,
    spread: 0.1
  }),
  // ---------------- Sniper & rail ----------------
  wpn({
    id: "sniper",
    name: "Sniper Rifle",
    family: "Sniper",
    desc: "Long-barrel precision rifle. Picks off units from far away.",
    category: "precision",
    visual: "sniper",
    caliber: 0.4,
    mount: "L",
    weight: 1.5,
    cost: 20,
    damage: 140,
    cooldown: 3.5,
    range: 10,
    ...G,
    projectile: "bullet",
    projectileSpeed: 60,
    ap: 0.6,
    spread: 0
  }),
  wpn({
    id: "lightrail",
    name: "Rail Rifle",
    family: "Light rail",
    desc: "Compact railgun. Pierces a line of enemies.",
    category: "precision",
    visual: "rail",
    caliber: 0.5,
    mount: "M",
    weight: 4,
    cost: 40,
    damage: 150,
    cooldown: 3,
    range: 10,
    ...GA,
    projectile: "rail",
    ap: 0.9,
    pierce: true
  }),
  wpn({
    id: "railgun",
    name: "Railgun",
    family: "Heavy rail",
    desc: "Pierces everything in a line. Extreme range.",
    category: "precision",
    visual: "rail",
    caliber: 0.9,
    mount: "H",
    weight: 9,
    cost: 75,
    damage: 320,
    cooldown: 4.5,
    range: 12,
    ...GA,
    projectile: "rail",
    ap: 1,
    pierce: true
  }),
  // ---------------- Rockets ----------------
  wpn({
    id: "rocketL",
    name: "Light Rocket Rack",
    family: "2-tube",
    desc: "Pair of unguided rockets.",
    category: "rocket",
    visual: "rocketPod",
    barrels: 2,
    caliber: 0.3,
    mount: "L",
    weight: 1.5,
    cost: 12,
    damage: 32,
    burst: 2,
    cooldown: 3,
    range: 6,
    ...G,
    projectile: "rocket",
    projectileSpeed: 11,
    splash: 0.7,
    ap: 0.2,
    spread: 0.7
  }),
  wpn({
    id: "rockets",
    name: "Rocket Pod",
    family: "4-tube",
    desc: "Salvo of 4 unguided rockets with splash.",
    category: "rocket",
    visual: "rocketPod",
    barrels: 4,
    caliber: 0.5,
    mount: "M",
    weight: 3,
    cost: 30,
    damage: 42,
    burst: 4,
    cooldown: 4,
    range: 7,
    ...G,
    projectile: "rocket",
    projectileSpeed: 11,
    splash: 1,
    ap: 0.2,
    spread: 0.8
  }),
  wpn({
    id: "incendiary",
    name: "Incendiary Rockets",
    family: "Napalm 4-tube",
    desc: "Rockets that leave targets burning.",
    category: "rocket",
    visual: "rocketPod",
    barrels: 4,
    caliber: 0.5,
    mount: "M",
    weight: 3.2,
    cost: 34,
    damage: 26,
    burst: 4,
    cooldown: 4.5,
    range: 7,
    ...G,
    projectile: "rocket",
    projectileSpeed: 11,
    splash: 1,
    ap: 0.2,
    spread: 0.8,
    burn: { dps: 12, duration: 4 }
  }),
  wpn({
    id: "mlrs",
    name: "MLRS Battery",
    family: "12-tube",
    desc: "Ripple-fires 12 rockets across a huge area. Minimum range 3.",
    category: "rocket",
    visual: "rocketPod",
    barrels: 12,
    caliber: 0.9,
    mount: "H",
    weight: 10,
    cost: 70,
    damage: 45,
    burst: 12,
    cooldown: 9,
    range: 13,
    minRange: 3,
    ...G,
    projectile: "rocket",
    projectileSpeed: 10,
    splash: 1,
    ap: 0.2,
    spread: 1.6
  }),
  // ---------------- Missiles ----------------
  wpn({
    id: "atgm",
    name: "ATGM Launcher",
    family: "Anti-tank",
    desc: "Wire-guided anti-tank missile on a light mount.",
    category: "missile",
    visual: "missileRack",
    barrels: 1,
    caliber: 0.3,
    mount: "L",
    weight: 1.6,
    cost: 18,
    damage: 110,
    cooldown: 4,
    range: 8,
    ...G,
    projectile: "missile",
    projectileSpeed: 9,
    splash: 0.2,
    ap: 0.8
  }),
  wpn({
    id: "aamissile",
    name: "AA Missile Pod",
    family: "Anti-air",
    desc: "Twin heat-seekers. Air only.",
    category: "missile",
    visual: "missileRack",
    barrels: 2,
    caliber: 0.3,
    mount: "L",
    weight: 1.4,
    cost: 16,
    damage: 60,
    burst: 2,
    cooldown: 3.5,
    range: 9,
    ...A,
    projectile: "missile",
    projectileSpeed: 11,
    splash: 0.3,
    ap: 0.4,
    airBonus: 1.5
  }),
  wpn({
    id: "sam",
    name: "Missile Rack",
    family: "Multi-role",
    desc: "Homing missiles. Long range, bonus vs aircraft.",
    category: "missile",
    visual: "missileRack",
    barrels: 4,
    caliber: 0.5,
    mount: "M",
    weight: 3,
    cost: 34,
    damage: 85,
    cooldown: 3,
    range: 9,
    ...GA,
    projectile: "missile",
    projectileSpeed: 9,
    splash: 0.4,
    ap: 0.5,
    airBonus: 1.6
  }),
  wpn({
    id: "swarm",
    name: "Swarm Missiles",
    family: "Swarm",
    desc: "Eight micro-missiles that spread across targets.",
    category: "missile",
    visual: "missileRack",
    barrels: 8,
    caliber: 0.5,
    mount: "M",
    weight: 3.5,
    cost: 40,
    damage: 28,
    burst: 8,
    cooldown: 6,
    range: 8.5,
    ...GA,
    projectile: "missile",
    projectileSpeed: 10,
    splash: 0.4,
    ap: 0.3,
    spread: 0.4
  }),
  wpn({
    id: "cruise",
    name: "Cruise Missile",
    family: "Strategic",
    desc: "One enormous long-range warhead. Slow to reload.",
    category: "missile",
    visual: "cruise",
    caliber: 0.9,
    mount: "H",
    weight: 9,
    cost: 80,
    damage: 480,
    cooldown: 10,
    range: 18,
    minRange: 4,
    ...G,
    projectile: "missile",
    projectileSpeed: 6,
    splash: 2.2,
    ap: 0.6
  }),
  // ---------------- Artillery ----------------
  wpn({
    id: "mortar",
    name: "Mortar",
    family: "81mm",
    desc: "Lobbed shells over the front line. Minimum range 3.",
    category: "artillery",
    visual: "mortar",
    caliber: 0.5,
    mount: "M",
    weight: 3.5,
    cost: 30,
    damage: 60,
    cooldown: 3,
    range: 10,
    minRange: 3,
    ...G,
    projectile: "arc",
    projectileSpeed: 5.5,
    splash: 1.2,
    ap: 0.2,
    spread: 0.8
  }),
  wpn({
    id: "howitzer",
    name: "Howitzer",
    family: "155mm",
    desc: "Long-range artillery with huge splash. Minimum range 5.",
    category: "artillery",
    visual: "artillery",
    caliber: 0.9,
    mount: "H",
    weight: 10,
    cost: 75,
    damage: 150,
    cooldown: 5,
    range: 16,
    minRange: 5,
    ...G,
    projectile: "arc",
    projectileSpeed: 6.5,
    splash: 2,
    ap: 0.3,
    spread: 1.2
  }),
  wpn({
    id: "barrage",
    name: "Barrage Cannon",
    family: "Scatter artillery",
    desc: "Fires six shells at once that blanket an area. Minimum range 4.",
    category: "artillery",
    visual: "artillery",
    barrels: 3,
    caliber: 0.8,
    mount: "H",
    weight: 11,
    cost: 80,
    damage: 42,
    pellets: 6,
    cooldown: 3.5,
    range: 12,
    minRange: 4,
    ...G,
    projectile: "arc",
    projectileSpeed: 6,
    splash: 1,
    ap: 0.2,
    spread: 2
  }),
  // ---------------- Energy ----------------
  wpn({
    id: "laser",
    name: "Pulse Laser",
    family: "Pulse",
    desc: "Accurate hitscan pulses with some armor pierce.",
    category: "energy",
    visual: "laser",
    caliber: 0.3,
    mount: "L",
    weight: 1.2,
    cost: 18,
    damage: 24,
    cooldown: 0.6,
    range: 5.5,
    ...GA,
    projectile: "beam",
    ap: 0.3
  }),
  wpn({
    id: "twinlaser",
    name: "Twin Pulse Laser",
    family: "Twin pulse",
    desc: "Two linked pulse emitters on a medium mount.",
    category: "energy",
    visual: "laser",
    barrels: 2,
    caliber: 0.4,
    mount: "M",
    weight: 2.6,
    cost: 34,
    damage: 24,
    cooldown: 0.15,
    range: 5.5,
    ...GA,
    magazine: 6,
    reload: 1.5,
    projectile: "beam",
    ap: 0.3
  }),
  wpn({
    id: "heatray",
    name: "Heat Ray",
    family: "Thermal",
    desc: "Continuous ray: melts anything close, fades with distance.",
    category: "energy",
    visual: "heatray",
    caliber: 0.5,
    mount: "M",
    weight: 3.5,
    cost: 32,
    damage: 32,
    cooldown: 0.2,
    range: 4.5,
    ...GA,
    projectile: "beam",
    ap: 0.5,
    falloff: 0.25
  }),
  wpn({
    id: "plasmaorb",
    name: "Plasma Cannon",
    family: "Plasma orb",
    desc: "Slow-moving plasma ball that bursts on impact.",
    category: "energy",
    visual: "plasma",
    caliber: 0.5,
    mount: "M",
    weight: 4,
    cost: 36,
    damage: 85,
    cooldown: 2,
    range: 6.5,
    ...G,
    projectile: "orb",
    projectileSpeed: 6,
    splash: 1.1,
    ap: 0.5,
    spread: 0.4
  }),
  wpn({
    id: "plasma",
    name: "Plasma Lance",
    family: "Plasma beam",
    desc: "Searing short-range beam with heavy armor pierce.",
    category: "energy",
    visual: "plasma",
    caliber: 0.9,
    mount: "H",
    weight: 8,
    cost: 65,
    damage: 48,
    cooldown: 0.25,
    range: 5,
    ...GA,
    projectile: "beam",
    ap: 0.6
  }),
  // ---------------- Flame ----------------
  wpn({
    id: "flamer",
    name: "Flamethrower",
    family: "Light flame",
    desc: "Short-range cone that ignores most armor.",
    category: "flame",
    visual: "flamer",
    caliber: 0.3,
    mount: "L",
    weight: 1.5,
    cost: 14,
    damage: 10,
    cooldown: 0.1,
    range: 3,
    ...G,
    projectile: "flame",
    projectileSpeed: 9,
    splash: 0.8,
    ap: 0.8,
    burn: { dps: 6, duration: 2 }
  }),
  wpn({
    id: "napalm",
    name: "Napalm Projector",
    family: "Napalm",
    desc: "Sticky burning gel. Wide cone, long burn.",
    category: "flame",
    visual: "flamer",
    caliber: 0.6,
    mount: "M",
    weight: 3.2,
    cost: 30,
    damage: 14,
    cooldown: 0.15,
    range: 4,
    ...G,
    projectile: "flame",
    projectileSpeed: 8,
    splash: 1.2,
    ap: 0.8,
    burn: { dps: 15, duration: 3 }
  }),
  // ---------------- Stun & disruption ----------------
  wpn({
    id: "tesla",
    name: "Tesla Coil",
    family: "Chain lightning",
    desc: "Lightning arcs that jump between up to 4 enemies.",
    category: "disruption",
    visual: "tesla",
    caliber: 0.5,
    mount: "M",
    weight: 3.5,
    cost: 32,
    damage: 48,
    cooldown: 1.2,
    range: 4,
    ...GA,
    projectile: "lightning",
    chain: 3,
    ap: 0.4
  }),
  wpn({
    id: "stungun",
    name: "Stun Gun",
    family: "Paralyzer",
    desc: "Electric bolt that paralyzes its target for 1.2s.",
    category: "disruption",
    visual: "emp",
    caliber: 0.3,
    mount: "L",
    weight: 1.2,
    cost: 18,
    damage: 8,
    cooldown: 1.5,
    range: 5,
    ...GA,
    projectile: "lightning",
    chain: 0,
    ap: 1,
    stun: 1.2
  }),
  wpn({
    id: "empcannon",
    name: "EMP Cannon",
    family: "EMP burst",
    desc: "Electromagnetic orb that stuns everything in the blast.",
    category: "disruption",
    visual: "emp",
    caliber: 0.6,
    mount: "M",
    weight: 3.5,
    cost: 38,
    damage: 20,
    cooldown: 3.5,
    range: 7,
    ...G,
    projectile: "orb",
    projectileSpeed: 7,
    splash: 1.2,
    ap: 1,
    stun: 1.5,
    spread: 0.3
  }),
  wpn({
    id: "slowbeam",
    name: "Slow Beam",
    family: "Disruptor",
    desc: "Beam that cuts target speed and rate of fire by up to 60%.",
    category: "disruption",
    visual: "slowbeam",
    caliber: 0.5,
    mount: "M",
    weight: 3,
    cost: 28,
    damage: 12,
    cooldown: 0.2,
    range: 6,
    ...GA,
    projectile: "beam",
    ap: 1,
    slow: 0.15
  }),
  wpn({
    id: "arclance",
    name: "Arc Lance",
    family: "Storm",
    desc: "Heavy lightning that chains through 6 enemies and jolts them.",
    category: "disruption",
    visual: "tesla",
    caliber: 0.9,
    mount: "H",
    weight: 9,
    cost: 75,
    damage: 105,
    cooldown: 1.6,
    range: 5.5,
    ...GA,
    projectile: "lightning",
    chain: 5,
    ap: 0.5,
    stun: 0.3
  }),
  wpn({
    id: "disarm",
    name: "Disarm Ray",
    family: "Disarmer",
    desc: "Scrambles weapon systems: target can move but not fire for 2s.",
    category: "disruption",
    visual: "emp",
    caliber: 0.5,
    mount: "M",
    weight: 3,
    cost: 34,
    damage: 15,
    cooldown: 2.5,
    range: 6.5,
    ...GA,
    projectile: "beam",
    ap: 1,
    disarm: 2
  }),
  wpn({
    id: "sonic",
    name: "Sonic Pulser",
    family: "Riot",
    desc: "Concussive blast that hurls light units backwards.",
    category: "disruption",
    visual: "sonic",
    caliber: 0.5,
    mount: "M",
    weight: 3.5,
    cost: 30,
    damage: 40,
    cooldown: 1.4,
    range: 3.5,
    ...G,
    projectile: "orb",
    projectileSpeed: 14,
    splash: 1,
    ap: 0.3,
    impulse: 1.6
  }),
  wpn({
    id: "gravity",
    name: "Gravity Gun",
    family: "Graviton",
    desc: "Yanks enemies toward you, dragging them out of formation.",
    category: "disruption",
    visual: "gravity",
    caliber: 0.8,
    mount: "H",
    weight: 8,
    cost: 60,
    damage: 30,
    cooldown: 0.8,
    range: 7,
    ...GA,
    projectile: "beam",
    ap: 1,
    impulse: -0.9
  }),
  // ---------------- Flak ----------------
  wpn({
    id: "flak",
    name: "Flak Cannon",
    family: "Light flak",
    desc: "Anti-air only. Bursting shells wreck aircraft groups.",
    category: "antiair",
    visual: "flak",
    caliber: 0.5,
    mount: "M",
    weight: 3,
    cost: 24,
    damage: 45,
    cooldown: 0.45,
    range: 7.5,
    ...A,
    magazine: 5,
    reload: 2.5,
    projectile: "shell",
    projectileSpeed: 16,
    splash: 1.3,
    ap: 0.2,
    airBonus: 1.5
  }),
  wpn({
    id: "heavyflak",
    name: "Heavy Flak Battery",
    family: "Heavy flak",
    desc: "Three-gun flak battery. Clears the sky at long range.",
    category: "antiair",
    visual: "flak",
    barrels: 3,
    caliber: 0.9,
    mount: "H",
    weight: 9,
    cost: 60,
    damage: 70,
    burst: 3,
    cooldown: 2.2,
    range: 10,
    ...A,
    projectile: "shell",
    projectileSpeed: 18,
    splash: 1.8,
    ap: 0.2,
    airBonus: 1.5
  }),
  // ---------------- Melee ----------------
  wpn({
    id: "buzzsaw",
    name: "Buzzsaw",
    family: "Circular saw",
    desc: "Spinning blade. Chews through light armor at contact range.",
    category: "melee",
    visual: "saw",
    caliber: 0.4,
    mount: "L",
    weight: 1.4,
    cost: 10,
    damage: 18,
    cooldown: 0.25,
    range: 0.6,
    ...MELEE,
    ap: 0.3
  }),
  wpn({
    id: "shockprod",
    name: "Shock Prod",
    family: "Stun prod",
    desc: "Electrified spike that stuns on contact.",
    category: "melee",
    visual: "prod",
    caliber: 0.3,
    mount: "L",
    weight: 1,
    cost: 12,
    damage: 22,
    cooldown: 1,
    range: 0.7,
    ...MELEE,
    ap: 0.5,
    stun: 0.8
  }),
  wpn({
    id: "ram",
    name: "Spike Ram",
    family: "Ram",
    desc: "Armored ram that batters targets backwards.",
    category: "melee",
    visual: "ram",
    caliber: 0.5,
    mount: "L",
    weight: 2,
    cost: 10,
    damage: 70,
    cooldown: 1.5,
    range: 0.4,
    ...MELEE,
    ap: 0.5,
    impulse: 1.2
  }),
  wpn({
    id: "chainsaw",
    name: "Chainsaw Arm",
    family: "Chainsaw",
    desc: "Relentless ripping teeth. Constant damage while locked on.",
    category: "melee",
    visual: "chainsaw",
    caliber: 0.6,
    mount: "M",
    weight: 3,
    cost: 22,
    damage: 30,
    cooldown: 0.2,
    range: 0.7,
    ...MELEE,
    ap: 0.4
  }),
  wpn({
    id: "claw",
    name: "Power Claw",
    family: "Hydraulic claw",
    desc: "Crushing hydraulic pincer with heavy armor pierce.",
    category: "melee",
    visual: "claw",
    caliber: 0.6,
    mount: "M",
    weight: 3.5,
    cost: 26,
    damage: 95,
    cooldown: 1,
    range: 0.8,
    ...MELEE,
    ap: 0.7
  }),
  wpn({
    id: "plasmablade",
    name: "Plasma Blade",
    family: "Energy blade",
    desc: "Superheated blade that sweeps through adjacent enemies.",
    category: "melee",
    visual: "blade",
    caliber: 0.6,
    mount: "M",
    weight: 2.5,
    cost: 30,
    damage: 55,
    cooldown: 0.5,
    range: 0.9,
    ...MELEE,
    splash: 0.8,
    ap: 0.8
  }),
  wpn({
    id: "hammer",
    name: "Siege Hammer",
    family: "Ground pound",
    desc: "Colossal hammer. Shockwave damages and knocks back everything nearby.",
    category: "melee",
    visual: "hammer",
    caliber: 0.9,
    mount: "H",
    weight: 9,
    cost: 55,
    damage: 260,
    cooldown: 2,
    range: 0.9,
    ...MELEE,
    splash: 1.3,
    ap: 0.6,
    impulse: 1
  }),
  wpn({
    id: "drill",
    name: "Drill Lance",
    family: "Bore drill",
    desc: "Armor-boring drill. Ignores all armor.",
    category: "melee",
    visual: "drill",
    caliber: 0.9,
    mount: "H",
    weight: 8,
    cost: 50,
    damage: 48,
    cooldown: 0.15,
    range: 0.8,
    ...MELEE,
    ap: 1
  }),
  // ---------------- Support (allies) ----------------
  util({ id: "repair", name: "Repair Beam", family: "Light repair", desc: "Heals the most damaged ally in range.", category: "support", visual: "repair", caliber: 0.3, mount: "L", weight: 1, cost: 17, heal: 22, range: 4 }),
  util({ id: "repairM", name: "Repair Array", family: "Heavy repair", desc: "Industrial nano-repair array with longer reach.", category: "support", visual: "repair", caliber: 0.6, mount: "M", weight: 2.5, cost: 40, heal: 55, range: 5 }),
  util({ id: "dome", name: "Shield Dome", family: "Area shield", desc: "Projects a 150-point shield onto every ally within 3 cells.", category: "support", visual: "dome", caliber: 0.8, mount: "H", weight: 6, cost: 60, shieldAura: { radius: 3, amount: 150 } }),
  util({ id: "uplink", name: "Command Uplink", family: "Command", desc: "Allies within 4 cells fire 15% faster.", category: "support", visual: "uplink", caliber: 0.5, mount: "M", weight: 2, cost: 15, fireRateAura: { radius: 4, bonus: 0.15 } }),
  util({ id: "sensor", name: "Sensor Mast", family: "Detection", desc: "Reveals cloaked enemies within 7 cells for your whole army.", category: "stealth", visual: "sensor", caliber: 0.4, mount: "L", weight: 1, cost: 7, detect: 7 }),
  // ---------------- Defense ----------------
  util({ id: "shield", name: "Shield Projector", family: "Energy shield", desc: "Personal energy shield that absorbs 260 damage and regenerates.", category: "defense", visual: "shield", caliber: 0.5, mount: "M", weight: 2.5, cost: 32, shield: 260 }),
  util({ id: "shieldL", name: "Shield Emitter", family: "Light shield", desc: "Small personal shield: absorbs 100 damage, regenerates.", category: "defense", visual: "shield", caliber: 0.25, mount: "L", weight: 1, cost: 14, shield: 100 }),
  util({ id: "shieldH", name: "Aegis Barrier", family: "Heavy shield", desc: "Massive personal barrier: absorbs 700 damage.", category: "defense", visual: "shield", caliber: 0.9, mount: "H", weight: 6, cost: 60, shield: 700 }),
  util({ id: "pointdef", name: "Point Defense Laser", family: "APS", desc: "Zaps incoming rockets, missiles and shells within 2.5 cells.", category: "defense", visual: "pointdef", caliber: 0.4, mount: "L", weight: 1.2, cost: 24, pointDefense: { range: 2.5, cooldown: 0.6 } }),
  util({ id: "smoke", name: "Smoke Launchers", family: "Obscurant", desc: "Below 60% hp, pops a smoke screen: nothing outside 2.5 cells can target units inside for 5s.", category: "defense", visual: "smoke", caliber: 0.3, mount: "L", weight: 0.8, cost: 12, smoke: { radius: 2, duration: 5 } }),
  util({ id: "reactive", name: "Reactive Armor", family: "ERA", desc: "Explosive tiles: the next 6 shell/rocket/missile hits deal 75% less damage.", category: "defense", visual: "plate", caliber: 0.5, mount: "M", weight: 3, cost: 22, reactive: 6, armor: 1 }),
  util({ id: "mirror", name: "Mirror Coating", family: "Reflective", desc: "Takes 45% less damage from beams, lightning, rails, plasma and flame.", category: "defense", visual: "plate", caliber: 0.4, mount: "L", weight: 1, cost: 14, energyResist: 0.45 }),
  util({ id: "hardened", name: "Hardened Systems", family: "EMP shielding", desc: "Immune to stun, slow, disarm, burning and knockback.", category: "defense", visual: "coolant", caliber: 0.4, mount: "L", weight: 1.2, cost: 8, hardened: true }),
  util({ id: "nanite", name: "Nanite Hull", family: "Self-repair", desc: "Regenerates 2.5% max hp per second when out of combat for 2s.", category: "defense", visual: "nanite", caliber: 0.4, mount: "L", weight: 1, cost: 8, regen: 0.025 }),
  // ---------------- Stealth & ECM ----------------
  util({ id: "stealth", name: "Stealth Cloak", family: "Optical cloak", desc: "Untargetable unless an enemy comes within 2.5 cells or it has just fired.", category: "stealth", visual: "cloak", caliber: 0.5, mount: "M", weight: 2, cost: 40, cloak: "stealth" }),
  util({ id: "phantom", name: "Phantom Field", family: "Phase cloak", desc: "Untargetable at any range, except for 3s after each shot it fires.", category: "stealth", visual: "cloak", caliber: 0.8, mount: "H", weight: 4, cost: 55, cloak: "phantom" }),
  util({ id: "jammer", name: "ECM Jammer", family: "Jammer", desc: "Enemy missiles lose lock on allies within 3 cells; enemy guns are half as accurate against them.", category: "stealth", visual: "jammer", caliber: 0.5, mount: "M", weight: 2, cost: 14, jammer: 3 }),
  // ---------------- Systems ----------------
  util({ id: "targeting", name: "Targeting Computer", family: "Fire control", desc: "+15% range for all weapons and tighter spread.", category: "systems", visual: "sensor", caliber: 0.3, mount: "L", weight: 0.8, cost: 8, rangeBonus: 0.15, spreadMult: 0.6 }),
  util({ id: "turbo", name: "Turbo Engine", family: "Engine", desc: "+20% move speed.", category: "systems", visual: "engine", caliber: 0.4, mount: "L", weight: 1.2, cost: 7, speedBonus: 0.2 }),
  util({ id: "gyro", name: "Gyro Stabilizer", family: "Stabilizer", desc: "All weapons can fire on the move, with tighter spread.", category: "systems", visual: "gyro", caliber: 0.3, mount: "L", weight: 1, cost: 8, gyro: true, spreadMult: 0.85 }),
  util({ id: "autoloader", name: "Autoloader", family: "Ammo feed", desc: "Clip weapons reload 40% faster.", category: "systems", visual: "coolant", caliber: 0.3, mount: "L", weight: 1, cost: 14, reloadBonus: 0.4 }),
  util({ id: "overclock", name: "Overclocked Core", family: "Overclock", desc: "All weapons fire 20% faster.", category: "systems", visual: "coolant", caliber: 0.5, mount: "M", weight: 2, cost: 14, fireRateBonus: 0.2 }),
  util({ id: "selfdestruct", name: "Self-Destruct Charge", family: "Demolition", desc: "Detonates on death for 300 damage in a 2-cell radius.", category: "systems", visual: "charge", caliber: 0.4, mount: "L", weight: 1.5, cost: 6, deathBlast: { damage: 300, radius: 2 } }),
  // ---------------- Armor ----------------
  { id: "plateL", name: "Armor Plate", family: "Light plate", desc: "+3 armor, +60 hp.", category: "armor", visual: "plate", caliber: 0.3, mount: "L", kind: "armor", weight: 2, cost: 8, armor: 3, hp: 60 },
  { id: "plateM", name: "Composite Armor", family: "Composite", desc: "+6 armor, +150 hp.", category: "armor", visual: "plate", caliber: 0.6, mount: "M", kind: "armor", weight: 5, cost: 20, armor: 6, hp: 150 },
  { id: "plateH", name: "Heavy Armor", family: "Heavy plate", desc: "+10 armor, +400 hp.", category: "armor", visual: "plate", caliber: 0.9, mount: "H", kind: "armor", weight: 12, cost: 35, armor: 10, hp: 400 }
];
var byId = (list) => new Map(list.map((p) => [p.id, p]));
var CHASSIS_BY_ID = byId(CHASSIS);
var MOBILITY_BY_ID = byId(MOBILITY);
var MODULE_BY_ID = byId(MODULES);
var RANK = { L: 1, M: 2, H: 3 };
var fitsMount = (slot, module) => RANK[module] <= RANK[slot];
function pairingError(chassisId, mobilityId) {
  const c = CHASSIS_BY_ID.get(chassisId);
  const m = MOBILITY_BY_ID.get(mobilityId);
  if (!c) return "Unknown chassis";
  if (!m) return "Unknown mobility";
  if (!m.sizes.includes(c.size)) return `${m.name} can't carry a size-${c.size} chassis`;
  if (c.traits.includes("airOnly") && m.kind !== "air") return `${c.name} must fly (rotor or jet)`;
  return null;
}

// src/client/audio.ts
var ac = null;
var master = null;
var sfxBus = null;
var comp = null;
var noiseBuf = null;
var vol = { master: 0.8, music: 0.55, sfx: 0.8 };
var panFlip = false;
var voices = 0;
var MAX_VOICES = 56;
var lastPlay = /* @__PURE__ */ new Map();
var playing = /* @__PURE__ */ new Map();
function ctx() {
  if (ac) return ac;
  try {
    const AC = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!AC) return null;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = vol.master;
    comp = ac.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 10;
    comp.ratio.value = 6;
    comp.attack.value = 3e-3;
    comp.release.value = 0.18;
    sfxBus = ac.createGain();
    sfxBus.gain.value = vol.sfx;
    sfxBus.connect(comp);
    comp.connect(master);
    master.connect(ac.destination);
    const len = ac.sampleRate;
    noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  } catch {
    ac = null;
  }
  return ac;
}
function unlockAudio() {
  try {
    const a = ctx();
    if (a && a.state === "suspended") void a.resume().catch(() => {
    });
    music.unlock();
  } catch {
  }
}
function setPanFlip(flip) {
  panFlip = flip;
}
var clamp01 = (v) => Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
function out(a, pan) {
  if (!sfxBus) return a.destination;
  if (pan && a.createStereoPanner) {
    const p = a.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(sfxBus);
    return p;
  }
  return sfxBus;
}
function track(node, end) {
  voices++;
  node.onended = () => {
    voices--;
  };
  void end;
}
function tone(wave, f0, f1, dur, gain, o = {}) {
  const a = ac;
  if (!a) return;
  const t = a.currentTime + (o.delay ?? 0);
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = wave;
  osc.frequency.setValueAtTime(Math.max(1, f0), t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  const at = o.attack ?? 2e-3;
  g.gain.setValueAtTime(1e-4, t);
  g.gain.exponentialRampToValueAtTime(Math.max(2e-4, gain), t + at);
  g.gain.exponentialRampToValueAtTime(1e-4, t + dur);
  osc.connect(g);
  g.connect(out(a, o.pan ?? 0));
  osc.start(t);
  osc.stop(t + dur + 0.02);
  track(osc, t + dur);
}
function noise(type, q, c0, c1, dur, gain, o = {}) {
  const a = ac;
  if (!a || !noiseBuf) return;
  const t = a.currentTime + (o.delay ?? 0);
  const src = a.createBufferSource();
  src.buffer = noiseBuf;
  const f = a.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(Math.max(20, c0), t);
  f.frequency.exponentialRampToValueAtTime(Math.max(20, c1), t + dur);
  const g = a.createGain();
  const at = o.attack ?? 2e-3;
  g.gain.setValueAtTime(1e-4, t);
  g.gain.exponentialRampToValueAtTime(Math.max(2e-4, gain), t + at);
  g.gain.exponentialRampToValueAtTime(1e-4, t + dur);
  src.connect(f);
  f.connect(g);
  g.connect(out(a, o.pan ?? 0));
  const off = Math.random() * 0.5;
  src.start(t, off, dur + 0.05);
  track(src, t + dur);
}
function gate(key, minGap, maxConcurrent = 6, dur = 0.2) {
  if (!ac || ac.state !== "running") return false;
  if (voices > MAX_VOICES) return false;
  const now = ac.currentTime;
  const last = lastPlay.get(key) ?? -1;
  if (now - last < minGap) return false;
  const until = playing.get(key) ?? 0;
  const active = Math.max(0, until - now) / dur;
  if (active >= maxConcurrent) return false;
  lastPlay.set(key, now);
  playing.set(key, Math.max(now, until) + dur);
  return true;
}
var R = {
  mg: (p, k) => {
    noise("bandpass", 1, 2600 * k, 1100, 0.04, 0.35, { pan: p });
    tone("square", 210 * k, 90, 0.03, 0.12, { pan: p });
  },
  hmg: (p, k) => {
    noise("bandpass", 0.9, 1900 * k, 700, 0.07, 0.45, { pan: p });
    tone("triangle", 150 * k, 60, 0.06, 0.3, { pan: p });
  },
  gatling: (p) => {
    noise("bandpass", 1.2, 3e3, 1600, 0.035, 0.28, { pan: p });
    tone("square", 260, 140, 0.02, 0.07, { pan: p });
  },
  shotgun: (p) => {
    noise("lowpass", 0.8, 3500, 400, 0.16, 0.7, { pan: p });
    tone("sine", 140, 50, 0.15, 0.45, { pan: p });
    noise("highpass", 0.7, 3e3, 3e3, 6e-3, 0.4, { pan: p });
  },
  autocannon: (p, k) => {
    tone("sine", 130 * k, 45, 0.12, 0.6, { pan: p });
    noise("lowpass", 0.8, 1600 * k, 300, 0.1, 0.55, { pan: p });
    noise("highpass", 0.7, 3200, 3200, 5e-3, 0.35, { pan: p });
  },
  cannon: (p, k) => {
    noise("highpass", 0.7, 3e3, 3e3, 6e-3, 0.6, { pan: p });
    tone("sine", 110 * k, 34, 0.35, 0.9, { pan: p });
    noise("lowpass", 0.8, 1800 * k, 140, 0.4, 0.8, { pan: p });
    noise("lowpass", 0.7, 600, 150, 0.35, 0.18, { pan: p, delay: 0.06 });
  },
  gauss: (p) => {
    tone("sawtooth", 300, 2400, 0.12, 0.18, { pan: p });
    noise("highpass", 0.7, 4e3, 2e3, 0.05, 0.5, { pan: p, delay: 0.1 });
    tone("sine", 900, 80, 0.25, 0.5, { pan: p, delay: 0.1 });
  },
  sniper: (p) => {
    noise("highpass", 0.7, 3500, 3500, 6e-3, 0.9, { pan: p });
    tone("sine", 95, 34, 0.25, 0.7, { pan: p });
    noise("bandpass", 0.9, 900, 350, 0.12, 0.5, { pan: p });
    noise("lowpass", 0.7, 650, 170, 0.4, 0.15, { pan: p, delay: 0.15 });
  },
  rail: (p, k) => {
    tone("sine", 500, 3200 * k, 0.22, 0.18, { pan: p, attack: 0.15 });
    noise("highpass", 0.7, 5e3, 1500, 0.08, 0.8, { pan: p, delay: 0.2 });
    tone("sawtooth", 1800, 60, 0.35, 0.4, { pan: p, delay: 0.2 });
  },
  rocketPod: (p) => {
    noise("bandpass", 1.6, 500, 2600, 0.32, 0.4, { pan: p, attack: 0.03 });
    tone("triangle", 120, 60, 0.08, 0.3, { pan: p });
  },
  missileRack: (p) => {
    noise("lowpass", 0.9, 400, 3200, 0.5, 0.45, { pan: p, attack: 0.05 });
    tone("sawtooth", 180, 520, 0.4, 0.06, { pan: p });
  },
  cruise: (p) => {
    noise("lowpass", 0.9, 200, 2400, 1, 0.7, { pan: p, attack: 0.1 });
    tone("sawtooth", 70, 160, 0.9, 0.12, { pan: p });
    tone("sine", 80, 40, 0.3, 0.6, { pan: p });
  },
  mortar: (p) => {
    tone("sine", 95, 40, 0.2, 0.7, { pan: p });
    noise("bandpass", 1.4, 420, 180, 0.18, 0.5, { pan: p });
    noise("lowpass", 0.8, 700, 100, 0.3, 0.3, { pan: p });
  },
  artillery: (p) => {
    noise("highpass", 0.7, 3e3, 3e3, 7e-3, 0.7, { pan: p });
    tone("sine", 70, 28, 0.6, 1, { pan: p });
    noise("lowpass", 0.8, 1e3, 80, 0.75, 0.9, { pan: p });
    noise("lowpass", 0.7, 500, 120, 0.6, 0.25, { pan: p, delay: 0.12 });
  },
  laser: (p, k) => {
    tone("sawtooth", 1800 * k, 320, 0.12, 0.13, { pan: p });
    tone("sine", 1100 * k, 260, 0.1, 0.2, { pan: p });
  },
  heatray: (p) => {
    noise("bandpass", 2, 900, 700, 0.2, 0.18, { pan: p, attack: 0.03 });
    tone("sawtooth", 95, 90, 0.2, 0.06, { pan: p, attack: 0.03 });
  },
  plasma: (p, k) => {
    tone("sawtooth", 110 * k, 85, 0.22, 0.12, { pan: p, attack: 0.02 });
    tone("sine", 230 * k, 180, 0.2, 0.18, { pan: p });
    noise("bandpass", 3, 1400, 900, 0.15, 0.1, { pan: p });
  },
  plasmaorb: (p) => {
    tone("sine", 600, 140, 0.3, 0.35, { pan: p });
    tone("sawtooth", 160, 90, 0.3, 0.08, { pan: p });
  },
  flamer: (p) => {
    noise("lowpass", 0.8, 900, 380, 0.25, 0.3, { pan: p, attack: 0.04 });
    noise("bandpass", 1, 2400, 1400, 0.12, 0.08, { pan: p });
  },
  tesla: (p) => {
    for (let i = 0; i < 5; i++) noise("highpass", 0.8, 2500 + Math.random() * 3e3, 2e3, 0.012 + Math.random() * 0.02, 0.4, { pan: p, delay: i * 0.03 + Math.random() * 0.02 });
    tone("square", 60, 58, 0.18, 0.08, { pan: p });
  },
  emp: (p) => {
    tone("square", 120, 40, 0.25, 0.14, { pan: p });
    noise("bandpass", 4, 3e3, 600, 0.25, 0.25, { pan: p });
  },
  slowbeam: (p) => {
    tone("sine", 300, 180, 0.2, 0.15, { pan: p });
    tone("sine", 306, 182, 0.2, 0.15, { pan: p });
  },
  sonic: (p) => {
    tone("sine", 140, 40, 0.3, 0.8, { pan: p });
    noise("bandpass", 1.2, 300, 120, 0.25, 0.5, { pan: p });
  },
  gravity: (p) => {
    tone("sine", 55, 110, 0.35, 0.5, { pan: p });
    tone("sawtooth", 40, 70, 0.3, 0.08, { pan: p });
  },
  flak: (p) => {
    noise("bandpass", 1.1, 1400, 500, 0.06, 0.45, { pan: p });
    tone("triangle", 260, 90, 0.06, 0.3, { pan: p });
  },
  melee: (p) => {
    noise("bandpass", 2, 1800, 900, 0.08, 0.45, { pan: p });
    tone("square", 900, 400, 0.04, 0.1, { pan: p });
    tone("sine", 120, 50, 0.1, 0.4, { pan: p });
  },
  saw: (p) => {
    tone("sawtooth", 900, 700, 0.2, 0.12, { pan: p });
    noise("bandpass", 6, 3500, 3e3, 0.2, 0.2, { pan: p });
  },
  hammer: (p) => {
    tone("sine", 80, 30, 0.35, 1, { pan: p });
    noise("lowpass", 0.8, 1500, 100, 0.3, 0.8, { pan: p });
    tone("triangle", 620, 600, 0.3, 0.1, { pan: p, delay: 0.01 });
  },
  pointdef: (p) => {
    tone("sawtooth", 2400, 900, 0.05, 0.06, { pan: p });
  },
  repair: (p) => {
    tone("sine", 880, 1320, 0.15, 0.07, { pan: p, attack: 0.03 });
  }
};
function weaponSound(id) {
  const m = MODULE_BY_ID.get(id);
  if (!m) return { key: "mg", k: 1, gap: 0.05, max: 4, dur: 0.05 };
  const cal2 = m.caliber ?? 0.5;
  const k = 1.25 - cal2 * 0.5;
  switch (m.visual) {
    case "gun":
      if (m.category === "autocannon") return { key: "autocannon", k, gap: 0.06, max: 5, dur: 0.12 };
      return cal2 >= 0.4 ? { key: "hmg", k, gap: 0.05, max: 5, dur: 0.07 } : { key: "mg", k, gap: 0.04, max: 5, dur: 0.04 };
    case "gatling":
      return { key: "gatling", k, gap: 0.035, max: 4, dur: 0.035 };
    case "shotgun":
      return { key: "shotgun", k, gap: 0.08, max: 3, dur: 0.16 };
    case "cannon":
      return { key: "cannon", k, gap: 0.08, max: 4, dur: 0.4 };
    case "gauss":
      return { key: "gauss", k, gap: 0.12, max: 3, dur: 0.35 };
    case "sniper":
      return { key: "sniper", k, gap: 0.1, max: 3, dur: 0.4 };
    case "rail":
      return { key: "rail", k: 1.3 - cal2 * 0.4, gap: 0.12, max: 3, dur: 0.55 };
    case "rocketPod":
      return { key: "rocketPod", k, gap: 0.06, max: 5, dur: 0.32 };
    case "missileRack":
      return { key: "missileRack", k, gap: 0.08, max: 4, dur: 0.5 };
    case "cruise":
      return { key: "cruise", k, gap: 0.3, max: 2, dur: 1 };
    case "mortar":
      return { key: "mortar", k, gap: 0.1, max: 3, dur: 0.3 };
    case "artillery":
      return { key: "artillery", k, gap: 0.15, max: 3, dur: 0.75 };
    case "laser":
      return { key: "laser", k, gap: 0.05, max: 4, dur: 0.12 };
    case "heatray":
      return { key: "heatray", k, gap: 0.15, max: 2, dur: 0.2 };
    case "plasma":
      return m.projectile === "orb" ? { key: "plasmaorb", k, gap: 0.12, max: 3, dur: 0.3 } : { key: "plasma", k, gap: 0.18, max: 2, dur: 0.22 };
    case "flamer":
      return { key: "flamer", k, gap: 0.18, max: 2, dur: 0.25 };
    case "tesla":
      return { key: "tesla", k, gap: 0.1, max: 3, dur: 0.2 };
    case "emp":
      return { key: "emp", k, gap: 0.1, max: 3, dur: 0.25 };
    case "slowbeam":
      return { key: "slowbeam", k, gap: 0.2, max: 2, dur: 0.2 };
    case "sonic":
      return { key: "sonic", k, gap: 0.12, max: 3, dur: 0.3 };
    case "gravity":
      return { key: "gravity", k, gap: 0.2, max: 2, dur: 0.35 };
    case "flak":
      return { key: "flak", k, gap: 0.06, max: 4, dur: 0.06 };
    case "saw":
    case "chainsaw":
    case "drill":
      return { key: "saw", k, gap: 0.12, max: 2, dur: 0.2 };
    case "hammer":
    case "ram":
      return { key: "hammer", k, gap: 0.15, max: 2, dur: 0.35 };
    case "claw":
    case "blade":
    case "prod":
      return { key: "melee", k, gap: 0.08, max: 3, dur: 0.1 };
    case "pointdef":
      return { key: "pointdef", k, gap: 0.08, max: 2, dur: 0.05 };
    case "repair":
      return null;
    // heal events handle it
    default:
      return m.kind === "weapon" ? { key: "hmg", k, gap: 0.06, max: 4, dur: 0.07 } : null;
  }
}
var panOf = (x) => {
  const p = x / FIELD_W * 2 - 1;
  return (panFlip ? -p : p) * 0.7;
};
function explosion(r, pan, big) {
  const s = Math.min(2.5, Math.max(0.3, r));
  noise("highpass", 0.7, 2500, 2500, 8e-3, 0.4 + 0.2 * s, { pan });
  tone("sine", 90 / (0.6 + s * 0.3), 28, 0.25 + s * 0.25, Math.min(1, 0.45 + s * 0.25), { pan });
  noise("lowpass", 0.8, 1400 / (0.5 + s * 0.3), 70, 0.3 + s * 0.35, Math.min(1, 0.4 + s * 0.3), { pan });
  if (big) noise("lowpass", 0.7, 400, 60, 1.2, 0.35, { pan, delay: 0.08 });
}
function battleSfx(events) {
  try {
    if (!ac || ac.state !== "running" || !events.length) return;
    const thin = events.length > 60 ? 60 / events.length : 1;
    for (const e of events) {
      if (thin < 1 && Math.random() > thin && e.t !== "death") continue;
      switch (e.t) {
        case "fire": {
          const w = weaponSound(e.moduleId);
          if (!w || !gate("w:" + w.key, w.gap, w.max, w.dur)) break;
          R[w.key]?.(panOf(e.x), w.k);
          break;
        }
        case "beam": {
          const m = MODULE_BY_ID.get(e.moduleId);
          if (m?.visual === "repair" && gate("repair", 0.35, 1, 0.15)) R.repair(panOf(e.x2), 1);
          break;
        }
        case "chain":
          if (e.points.length > 1 && gate("chainzap", 0.08, 3, 0.2)) {
            const p = panOf(e.points[e.points.length - 1].x);
            for (let i = 0; i < Math.min(6, e.points.length); i++) noise("highpass", 0.8, 3e3 + Math.random() * 2e3, 2200, 0.02, 0.25, { pan: p, delay: i * 0.025 });
          }
          break;
        case "hit":
          if (e.shieldHit) {
            if (gate("shield", 0.06, 3, 0.15)) tone("sine", 1300, 600, 0.15, 0.12, { pan: panOf(e.x) });
          } else if (e.damage >= 50) {
            if (gate("hitBig", 0.05, 4, 0.1)) {
              noise("bandpass", 2, 1500, 600, 0.08, 0.3, { pan: panOf(e.x) });
              tone("triangle", 520, 480, 0.12, 0.06, { pan: panOf(e.x) });
            }
          } else if (gate("hit", 0.035, 4, 0.03)) noise("highpass", 0.9, 3200, 2400, 0.025, 0.14, { pan: panOf(e.x) });
          break;
        case "explode": {
          const m = MODULE_BY_ID.get(e.moduleId);
          const key = e.radius >= 1.4 ? "boomL" : e.radius >= 0.6 ? "boomM" : "boomS";
          if (m?.visual === "flak") {
            if (gate("flakburst", 0.06, 4, 0.12)) {
              noise("bandpass", 1, 1800, 500, 0.12, 0.4, { pan: panOf(e.x) });
              tone("sine", 220, 70, 0.1, 0.3, { pan: panOf(e.x) });
            }
            break;
          }
          if (m?.visual === "emp") {
            if (gate("empburst", 0.1, 2, 0.3)) R.emp(panOf(e.x), 1);
            break;
          }
          if (!gate(key, key === "boomL" ? 0.12 : 0.06, key === "boomL" ? 3 : 5, 0.5)) break;
          explosion(e.radius, panOf(e.x), m?.visual === "cruise" || e.radius >= 2);
          break;
        }
        case "heal":
          if (gate("heal", 0.4, 1, 0.15)) tone("sine", 1046, 1568, 0.18, 0.05, { attack: 0.04 });
          break;
        case "death": {
          if (!gate("death", 0.05, 5, 0.6)) break;
          const p = panOf(e.x);
          explosion(0.8 + e.size * 0.6, p, e.size >= 2);
          for (let i = 0; i < 2 + e.size; i++) tone("triangle", 400 + Math.random() * 900, 300, 0.12, 0.05, { pan: p, delay: 0.1 + Math.random() * 0.4 });
          break;
        }
        case "leap":
          if (gate("leap", 0.1, 3, 0.3)) noise("bandpass", 1.5, 300, 1500, 0.3, 0.25, { attack: 0.05 });
          break;
        default: {
          const ev = e;
          if (ev.t === "smoke" && gate("smoke", 0.3, 2, 0.6)) noise("lowpass", 0.8, 1200, 300, 0.6, 0.3, { pan: panOf(ev.x ?? FIELD_W / 2), attack: 0.03 });
        }
      }
    }
  } catch {
  }
}
var TRACKS = {
  menu: { file: "title.mp3", loop: true, rate: 1 },
  deploy: { file: "tension.mp3", loop: true, rate: 1 },
  battle: { file: "combat.mp3", loop: true, rate: 1 },
  victory: { file: "win.mp3", loop: false, rate: 1 },
  // somber: the explore theme slowed and pitched down
  defeat: { file: "explore.mp3", loop: true, rate: 0.8 }
};
var musicBase = "assets/music/";
var music = {
  chans: [],
  want: null,
  timer: 0,
  play(track2) {
    this.want = track2;
    for (const c of this.chans) c.target = c.track === track2 ? 1 : 0;
    if (track2 && !this.chans.some((c) => c.track === track2 && c.target === 1 && !c.el.ended)) {
      const def = TRACKS[track2];
      if (typeof Audio === "undefined") return;
      const el2 = new Audio(musicBase + def.file);
      el2.loop = def.loop;
      el2.preload = "auto";
      try {
        el2.playbackRate = def.rate;
        el2.preservesPitch = false;
      } catch {
      }
      el2.volume = 0;
      const ch = { el: el2, track: track2, fade: 0, target: 1 };
      this.chans.push(ch);
      void el2.play().catch(() => {
      });
    }
    this.ensureTimer();
  },
  unlock() {
    for (const c of this.chans) if (c.target > 0 && c.el.paused && !c.el.ended) void c.el.play().catch(() => {
    });
  },
  applyVolume() {
    for (const c of this.chans) c.el.volume = clamp01(c.fade * vol.master * vol.music);
  },
  ensureTimer() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      const step = 0.05 / 1.2;
      for (const c of this.chans) {
        if (c.fade < c.target) c.fade = Math.min(c.target, c.fade + step);
        else if (c.fade > c.target) c.fade = Math.max(c.target, c.fade - step);
      }
      this.applyVolume();
      this.chans = this.chans.filter((c) => {
        if (c.target === 0 && c.fade <= 0) {
          c.el.pause();
          c.el.src = "";
          return false;
        }
        return true;
      });
      if (!this.chans.length && this.timer) {
        clearInterval(this.timer);
        this.timer = 0;
      }
    }, 50);
  }
};
function playMusic(track2) {
  try {
    if (track2 === music.want && music.chans.some((c) => c.track === track2 && c.target === 1)) return;
    music.play(track2);
  } catch {
  }
}

// src/client/render/camera.ts
var MAX_K = 80;
var clampN = (v, a, b) => Math.max(a, Math.min(b, v));
var Camera = class {
  cx;
  cy;
  k = 1;
  tcx;
  tcy;
  tk = 1;
  vw = 300;
  vh = 400;
  minK = 1;
  maxK = MAX_K;
  /** exponential smoothing rate (1/s) */
  smooth = 13;
  /** seconds since the camera last moved (used to decide when to re-render hi-res ground) */
  still = 0;
  /** continuous key pan direction, -1..1 (screen axes) */
  keyX = 0;
  keyY = 0;
  anchor = null;
  velX = 0;
  // inertia, visual cells / s
  velY = 0;
  fw;
  fh;
  constructor(fw, fh) {
    this.fw = fw;
    this.fh = fh;
    this.cx = this.tcx = fw / 2;
    this.cy = this.tcy = fh / 2;
  }
  /** Set the viewport size (CSS px). Keeps the fit view fitted. */
  setViewport(w, h) {
    const wasFit = this.vw > 0 && this.tk <= this.minK * 1.001;
    this.vw = Math.max(1, w);
    this.vh = Math.max(1, h);
    this.minK = Math.max(0.5, Math.min(this.vw / this.fw, this.vh / this.fh));
    this.maxK = Math.max(MAX_K, this.minK * 1.5);
    if (wasFit) this.k = this.tk = this.minK;
    this.k = clampN(this.k, this.minK, this.maxK);
    this.tk = clampN(this.tk, this.minK, this.maxK);
    this.clampTarget();
    this.clampCurrent();
  }
  get isFit() {
    return this.tk <= this.minK * 1.02;
  }
  clampAxis(c, k, view, field) {
    const half = view / (2 * k);
    if (half * 2 >= field) return field / 2;
    const pad = half * 0.35;
    const lo = half - pad, hi = field - half + pad;
    if (lo >= hi) return field / 2;
    return clampN(c, lo, hi);
  }
  clampTarget() {
    this.tcx = this.clampAxis(this.tcx, this.tk, this.vw, this.fw);
    this.tcy = this.clampAxis(this.tcy, this.tk, this.vh, this.fh);
  }
  clampCurrent() {
    const x = this.clampAxis(this.cx, this.k, this.vw, this.fw);
    const y = this.clampAxis(this.cy, this.k, this.vh, this.fh);
    const hit = x !== this.cx || y !== this.cy;
    this.cx = x;
    this.cy = y;
    return hit;
  }
  /** visual cells -> screen CSS px */
  toScreen(vx, vy) {
    return { x: this.vw / 2 + (vx - this.cx) * this.k, y: this.vh / 2 + (vy - this.cy) * this.k };
  }
  fromScreen(sx, sy) {
    return { x: this.cx + (sx - this.vw / 2) / this.k, y: this.cy + (sy - this.vh / 2) / this.k };
  }
  stopInertia() {
    this.velX = this.velY = 0;
  }
  /** Direct manipulation: pan by a screen delta, immediately (no easing). */
  panByScreen(dx, dy) {
    this.anchor = null;
    this.cx -= dx / this.k;
    this.cy -= dy / this.k;
    this.clampCurrent();
    this.tcx = this.cx;
    this.tcy = this.cy;
    this.tk = this.k;
    this.still = 0;
  }
  /** Direct manipulation: zoom about a screen point, immediately. */
  zoomAtInstant(f, sx, sy) {
    this.anchor = null;
    const w = this.fromScreen(sx, sy);
    const nk = clampN(this.k * f, this.minK, this.maxK);
    this.k = nk;
    this.cx = w.x - (sx - this.vw / 2) / nk;
    this.cy = w.y - (sy - this.vh / 2) / nk;
    this.clampCurrent();
    this.tcx = this.cx;
    this.tcy = this.cy;
    this.tk = this.k;
    this.still = 0;
  }
  /** Eased zoom about a screen point (wheel, buttons). Default point: viewport center. */
  zoomBy(f, sx = this.vw / 2, sy = this.vh / 2) {
    const nk = clampN(this.tk * f, this.minK, this.maxK);
    if (nk === this.tk) return;
    const w = this.fromScreen(sx, sy);
    this.anchor = { sx, sy, vx: w.x, vy: w.y };
    this.tk = nk;
    this.tcx = w.x - (sx - this.vw / 2) / nk;
    this.tcy = w.y - (sy - this.vh / 2) / nk;
    this.clampTarget();
    this.stopInertia();
    this.still = 0;
  }
  /** Eased move to a view (visual coords). k in CSS px per cell. */
  setTarget(vx, vy, k, instant = false) {
    this.anchor = null;
    this.stopInertia();
    this.tk = clampN(k, this.minK, this.maxK);
    this.tcx = vx;
    this.tcy = vy;
    this.clampTarget();
    if (instant) {
      this.k = this.tk;
      this.cx = this.tcx;
      this.cy = this.tcy;
    }
    this.still = 0;
  }
  fit(instant = false) {
    this.setTarget(this.fw / 2, this.fh / 2, this.minK, instant);
  }
  /** Fling after a drag; velocity in screen px / s. */
  fling(vxPx, vyPx) {
    this.velX = -vxPx / this.k;
    this.velY = -vyPx / this.k;
  }
  /** Advance the animation. Returns true while the camera is moving. */
  update(dt) {
    dt = clampN(dt, 0, 0.1);
    const f = 1 - Math.exp(-dt * this.smooth);
    let moving = false;
    if (this.velX || this.velY) {
      this.cx += this.velX * dt;
      this.cy += this.velY * dt;
      if (this.clampCurrent()) this.velX = this.velY = 0;
      this.tcx = this.cx;
      this.tcy = this.cy;
      const d = Math.exp(-dt * 3.2);
      this.velX *= d;
      this.velY *= d;
      if (Math.hypot(this.velX, this.velY) * this.k < 6) this.velX = this.velY = 0;
      moving = true;
    }
    if (this.keyX || this.keyY) {
      const sp = 560 / this.k;
      this.anchor = null;
      this.tcx += this.keyX * sp * dt;
      this.tcy += this.keyY * sp * dt;
      this.clampTarget();
      moving = true;
    }
    const lk = Math.log(this.k), ltk = Math.log(this.tk);
    if (Math.abs(ltk - lk) > 5e-4) {
      this.k = Math.exp(lk + (ltk - lk) * f);
      moving = true;
    } else this.k = this.tk;
    if (this.anchor) {
      const a = this.anchor;
      this.cx = a.vx - (a.sx - this.vw / 2) / this.k;
      this.cy = a.vy - (a.sy - this.vh / 2) / this.k;
      if (this.k === this.tk) this.anchor = null;
    } else {
      const ex = this.tcx - this.cx, ey = this.tcy - this.cy;
      if (Math.abs(ex) * this.k > 0.05 || Math.abs(ey) * this.k > 0.05) {
        this.cx += ex * f;
        this.cy += ey * f;
        moving = true;
      } else {
        this.cx = this.tcx;
        this.cy = this.tcy;
      }
    }
    this.clampCurrent();
    this.still = moving ? 0 : this.still + dt;
    return moving;
  }
};
var MOUSE_DRAG_PX = 6;
var TOUCH_DRAG_PX = 8;
var CameraControls = class _CameraControls {
  _enabled = true;
  /** double click / double tap zooms in on the point (or back to fit). Screens may switch this off temporarily. */
  doubleClickZoom = true;
  ptrs = /* @__PURE__ */ new Map();
  panning = false;
  pinching = false;
  dragged = false;
  pinchDist = 0;
  pinchMidX = 0;
  pinchMidY = 0;
  samples = [];
  lastTap = null;
  keys = /* @__PURE__ */ new Set();
  offs = [];
  cam;
  canvas;
  constructor(cam, canvas, enabled = true) {
    this.cam = cam;
    this.canvas = canvas;
    this.enabled = enabled;
    const on = (t, type, fn, opts) => {
      t.addEventListener(type, fn, opts);
      this.offs.push(() => t.removeEventListener(type, fn, opts));
    };
    on(canvas, "pointerdown", (e) => this.down(e));
    on(canvas, "pointermove", (e) => this.move(e));
    on(canvas, "pointerup", (e) => this.up(e, false));
    on(canvas, "pointercancel", (e) => this.up(e, true));
    on(canvas, "wheel", (e) => this.wheel(e), { passive: false });
    on(canvas, "contextmenu", (e) => {
      if (this.enabled && this.rightDragged) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
      this.rightDragged = false;
    });
    on(canvas, "auxclick", (e) => {
      if (this.enabled && e.button === 1) e.preventDefault();
    });
    on(window, "keydown", (e) => this.keyDown(e));
    on(window, "keyup", (e) => this.keyUp(e));
    on(window, "blur", () => {
      this.keys.clear();
      this.syncKeys();
    });
  }
  rightDragged = false;
  get enabled() {
    return this._enabled;
  }
  set enabled(v) {
    this._enabled = v;
    if (!v) {
      this.ptrs.clear();
      this.keys.clear();
      this.syncKeys();
      this.panning = this.pinching = false;
    }
    try {
      this.canvas.style.touchAction = v ? "none" : "";
    } catch {
    }
  }
  /** true if the pointer gesture that just ended was a pan / pinch (not a click or tap) */
  get wasDrag() {
    return this.dragged;
  }
  /** returns wasDrag and clears it; call from your pointerup/click handler to ignore the end of a pan */
  consumeDrag() {
    const d = this.dragged;
    this.dragged = false;
    return d;
  }
  destroy() {
    for (const f of this.offs) f();
    this.offs = [];
  }
  pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  down(e) {
    if (!this._enabled) return;
    if (this.ptrs.size === 0) {
      this.dragged = false;
      this.panning = false;
      this.pinching = false;
      this.rightDragged = false;
      this.samples = [];
    }
    const p = this.pos(e);
    this.ptrs.set(e.pointerId, { x: p.x, y: p.y, sx: p.x, sy: p.y, type: e.pointerType, button: e.button, t0: performance.now() });
    this.cam.stopInertia();
    if (e.button === 1) e.preventDefault();
    if (this.ptrs.size === 2) this.startPinch();
    else if (this.ptrs.size === 1 && (e.button === 1 || e.button === 2)) {
      this.panning = true;
      this.dragged = true;
    }
  }
  startPinch() {
    const [a, b] = [...this.ptrs.values()];
    this.pinching = true;
    this.panning = false;
    this.dragged = true;
    this.pinchDist = Math.max(8, Math.hypot(a.x - b.x, a.y - b.y));
    this.pinchMidX = (a.x + b.x) / 2;
    this.pinchMidY = (a.y + b.y) / 2;
  }
  move(e) {
    const q = this.ptrs.get(e.pointerId);
    if (!q || !this._enabled) return;
    const p = this.pos(e);
    const dx = p.x - q.x, dy = p.y - q.y;
    q.x = p.x;
    q.y = p.y;
    if (this.pinching && this.ptrs.size >= 2) {
      const [a, b] = [...this.ptrs.values()];
      const d = Math.max(8, Math.hypot(a.x - b.x, a.y - b.y));
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      this.cam.panByScreen(mx - this.pinchMidX, my - this.pinchMidY);
      this.cam.zoomAtInstant(d / this.pinchDist, mx, my);
      this.pinchDist = d;
      this.pinchMidX = mx;
      this.pinchMidY = my;
      e.preventDefault();
      return;
    }
    if (this.ptrs.size !== 1) return;
    if (!this.panning) {
      if (q.button !== 0) return;
      const thr = q.type === "mouse" ? MOUSE_DRAG_PX : TOUCH_DRAG_PX;
      if (Math.hypot(p.x - q.sx, p.y - q.sy) <= thr) return;
      this.panning = true;
      this.dragged = true;
      this.cam.panByScreen(p.x - q.sx, p.y - q.sy);
    } else this.cam.panByScreen(dx, dy);
    if (q.button === 2) this.rightDragged = true;
    const t = performance.now();
    this.samples.push({ t, x: p.x, y: p.y });
    while (this.samples.length > 2 && t - this.samples[0].t > 100) this.samples.shift();
  }
  up(e, cancel) {
    const q = this.ptrs.get(e.pointerId);
    if (!q) return;
    this.ptrs.delete(e.pointerId);
    if (!this._enabled) return;
    const now = performance.now();
    if (this.pinching) {
      if (this.ptrs.size === 1) {
        this.pinching = false;
        this.panning = true;
        this.samples = [];
      } else if (this.ptrs.size === 0) this.pinching = false;
      return;
    }
    if (this.ptrs.size > 0) return;
    if (this.panning) {
      this.panning = false;
      if (!cancel) {
        const s = this.samples;
        if (s.length >= 2 && now - s[s.length - 1].t < 70) {
          const a = s[0], b = s[s.length - 1];
          const dt = (b.t - a.t) / 1e3;
          if (dt > 0.012) {
            const vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt;
            if (Math.hypot(vx, vy) > 120) this.cam.fling(clampN(vx, -3e3, 3e3), clampN(vy, -3e3, 3e3));
          }
        }
      }
      this.samples = [];
      this.lastTap = null;
      return;
    }
    if (cancel || q.button !== 0 || this.dragged) {
      this.lastTap = null;
      return;
    }
    const lt = this.lastTap;
    if (lt && now - lt.t < 350 && Math.hypot(q.x - lt.x, q.y - lt.y) < 30) {
      this.lastTap = null;
      if (this.doubleClickZoom) this.doubleTap(q.x, q.y);
    } else this.lastTap = { t: now, x: q.x, y: q.y };
  }
  doubleTap(sx, sy) {
    const c = this.cam;
    if (c.tk > c.minK * 1.6) c.fit();
    else {
      const w = c.fromScreen(sx, sy);
      c.setTarget(w.x, w.y, Math.min(c.maxK, Math.max(c.minK * 2.8, 22)));
    }
  }
  wheel(e) {
    if (!this._enabled) return;
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    const f = clampN(Math.exp(-dy * (e.ctrlKey ? 0.011 : 16e-4)), 0.6, 1.7);
    const p = this.pos(e);
    this.cam.zoomBy(f, p.x, p.y);
  }
  /* keyboard */
  static PAN = /* @__PURE__ */ new Set(["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"]);
  keyOk(e) {
    if (!this._enabled || e.ctrlKey || e.metaKey || e.altKey) return false;
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return false;
    if (document.querySelector(".modal-back")) return false;
    return true;
  }
  keyDown(e) {
    if (!this.keyOk(e)) return;
    const k = e.key.toLowerCase();
    if (_CameraControls.PAN.has(k)) {
      this.keys.add(k);
      this.syncKeys();
      e.preventDefault();
    } else if (k === "+" || k === "=" || k === "add") {
      this.cam.zoomBy(1.3);
      e.preventDefault();
    } else if (k === "-" || k === "_" || k === "subtract") {
      this.cam.zoomBy(1 / 1.3);
      e.preventDefault();
    } else if (k === "home" || k === "f") {
      this.cam.fit();
      e.preventDefault();
    }
  }
  keyUp(e) {
    if (this.keys.delete(e.key.toLowerCase())) this.syncKeys();
  }
  syncKeys() {
    const h = (a, b) => (this.keys.has(a) ? 1 : 0) - (this.keys.has(b) ? 1 : 0);
    this.cam.keyX = clampN(h("d", "a") + h("arrowright", "arrowleft"), -1, 1);
    this.cam.keyY = clampN(h("s", "w") + h("arrowdown", "arrowup"), -1, 1);
  }
};

// src/shared/sim/types.ts
var TICK_RATE = 20;
var DT = 1 / TICK_RATE;
var MAX_TICKS = TICK_RATE * 120;

// src/client/render/palette.ts
var TEAM_PAL = [
  { body: "#3d6f8e", light: "#7bb3cf", dark: "#24435a", deep: "#132634", accent: "#46e8d2", glow: "#86f3ff", glowRgb: "134,243,255", bar: "#4fe3b8" },
  { body: "#9b4a32", light: "#dc8a5e", dark: "#5c2a1c", deep: "#2e140d", accent: "#ffb23e", glow: "#ffb27a", glowRgb: "255,170,110", bar: "#ff6a4a" }
];
var METAL = { base: "#545b62", light: "#8c959e", dark: "#2b3035", deep: "#16191c", rubber: "#1d1f21", rubberHi: "#3a3e42" };
var OUTLINE = "#0b0d0f";
function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}
function ctx2d(c) {
  const g = c.getContext("2d");
  if (!g) throw new Error("2d context unavailable");
  return g;
}
var hexRgb = (h) => {
  const n = parseInt(h.slice(1), 16);
  return [n >> 16 & 255, n >> 8 & 255, n & 255];
};
var toHex = (r, g, b) => "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
var shade = (h, k) => {
  const [r, g, b] = hexRgb(h);
  return k >= 0 ? toHex(r + (255 - r) * k, g + (255 - g) * k, b + (255 - b) * k) : toHex(r * (1 + k), g * (1 + k), b * (1 + k));
};
var rgba = (h, a) => {
  const [r, g, b] = hexRgb(h);
  return `rgba(${r},${g},${b},${a})`;
};
function roundRect(g, x, y, w, h, r) {
  r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.arcTo(x + w, y, x + w, y + r, r);
  g.lineTo(x + w, y + h - r);
  g.arcTo(x + w, y + h, x + w - r, y + h, r);
  g.lineTo(x + r, y + h);
  g.arcTo(x, y + h, x, y + h - r, r);
  g.lineTo(x, y + r);
  g.arcTo(x, y, x + r, y, r);
  g.closePath();
}
function poly(g, pts, s = 1) {
  g.moveTo(pts[0] * s, pts[1] * s);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i] * s, pts[i + 1] * s);
  g.closePath();
}
function mirrorPoly(half) {
  const out2 = half.slice();
  for (let i = half.length - 2; i >= 0; i -= 2) {
    if (Math.abs(half[i + 1]) < 1e-6) continue;
    out2.push(half[i], -half[i + 1]);
  }
  return out2;
}
var dotCache = /* @__PURE__ */ new Map();
function softDot(color, hard = 0) {
  const key = color + "|" + hard;
  let c = dotCache.get(key);
  if (c) return c;
  c = makeCanvas(64, 64);
  const g = ctx2d(c);
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, color);
  gr.addColorStop(Math.min(0.9, 0.15 + hard), color);
  gr.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  dotCache.set(key, c);
  return c;
}
var clamp = (v, a, b) => v < a ? a : v > b ? b : v;
var lerp = (a, b, t) => a + (b - a) * t;
function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
function hash01(n) {
  let h = Math.imul(n ^ 2654435769, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// src/client/render/textures.ts
var FILES = {
  shockwave: "shockwave.png",
  spark: "spark.png",
  fireball: "fireball.png",
  smoke: "smoke1.png",
  hex: "hexbig.png",
  eball: "lightningball4.png",
  wbolt: "whitelightningball.png",
  burn: "burncircle.png",
  flower: "flowerflash.png",
  lring: "lightring.png",
  orangesmoke: "orangesmoke.png"
};
var base = "assets/zk/pd/";
var imgs = /* @__PURE__ */ new Map();
var ready = /* @__PURE__ */ new Set();
var started = false;
function loadTextures() {
  if (started || typeof Image === "undefined") return;
  started = true;
  for (const [k, f] of Object.entries(FILES)) {
    const im = new Image();
    im.onload = () => ready.add(k);
    im.onerror = () => {
    };
    im.src = base + f;
    imgs.set(k, im);
  }
}
function tex(name) {
  if (!started) loadTextures();
  return ready.has(name) ? imgs.get(name) : null;
}
var tintCache = /* @__PURE__ */ new Map();
function tinted(name, color) {
  const im = tex(name);
  if (!im) return null;
  const key = name + color;
  let c = tintCache.get(key);
  if (c) return c;
  const w = Math.min(128, im.naturalWidth || 128), h = Math.min(128, im.naturalHeight || 128);
  c = makeCanvas(w, h);
  const g = ctx2d(c);
  g.drawImage(im, 0, 0, w, h);
  g.globalCompositeOperation = "multiply";
  g.fillStyle = color;
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = "destination-in";
  g.drawImage(im, 0, 0, w, h);
  tintCache.set(key, c);
  return c;
}

// src/client/render/fx.ts
var modOf = (id) => id ? MODULE_BY_ID.get(id) : void 0;
var SPARK = 0;
var SMOKE = 1;
var FIRE = 2;
var GLOW = 3;
var DEBRIS = 4;
var RING = 5;
var HEAL = 6;
var DUST = 7;
var EMBER = 8;
var STAR = 9;
var HEX = 10;
var BOLT = 11;
var MAX_P = 2600;
var rnd = Math.random;
var rr = (a, b) => a + (b - a) * rnd();
var Fx = class {
  parts = [];
  beams = [];
  later = [];
  trauma = 0;
  time = 0;
  // decals
  decals = [];
  decalCanvas = null;
  decalPx = 0;
  fieldW = 0;
  fieldH = 0;
  clear() {
    this.parts.length = 0;
    this.beams.length = 0;
    this.later.length = 0;
    this.decals.length = 0;
    this.trauma = 0;
    if (this.decalCanvas) ctx2d(this.decalCanvas).clearRect(0, 0, this.decalCanvas.width, this.decalCanvas.height);
  }
  /** load factor 0..1: shed optional particles when busy */
  get busy() {
    return this.parts.length / MAX_P;
  }
  add(k, x, y, o) {
    if (this.parts.length >= MAX_P) return;
    this.parts.push({
      k,
      x,
      y,
      z: o.z ?? 0,
      vx: o.vx ?? 0,
      vy: o.vy ?? 0,
      vz: o.vz ?? 0,
      life: o.max ?? 0.5,
      max: o.max ?? 0.5,
      size: o.size ?? 0.2,
      grow: o.grow ?? 0,
      color: o.color ?? "#ffffff",
      rot: o.rot ?? rnd() * 6.28,
      vr: o.vr ?? 0,
      drag: o.drag ?? 0,
      alpha: o.alpha ?? 1
    });
  }
  schedule(delay, fn) {
    this.later.push({ t: this.time + delay, fn });
  }
  shake(amount) {
    this.trauma = Math.min(1, this.trauma + amount);
  }
  /* ---------------------------------------------------------------------------------------- spawners */
  sparks(x, y, n, color, speed = 4, ang, spread = Math.PI, life = 0.25) {
    n = Math.round(n * (this.busy > 0.6 ? 0.4 : 1));
    for (let i = 0; i < n; i++) {
      const a = ang === void 0 ? rnd() * Math.PI * 2 : ang + rr(-spread, spread);
      const v = speed * rr(0.35, 1);
      this.add(SPARK, x, y, { vx: Math.cos(a) * v, vy: Math.sin(a) * v, max: life * rr(0.6, 1.2), size: rr(0.02, 0.045), color, drag: 3 });
    }
  }
  glow(x, y, r, color, life = 0.12, alpha = 1) {
    this.add(GLOW, x, y, { size: r, max: life, color, alpha });
  }
  star(x, y, r, color, ang, life = 0.07) {
    this.add(STAR, x, y, { size: r, max: life, color, rot: ang, alpha: 1 });
  }
  smoke(x, y, r, life = 1.2, color = "#2a2622", vx = 0, vy = 0, alpha = 0.5) {
    if (this.busy > 0.8 && rnd() < 0.5) return;
    this.add(SMOKE, x, y, { size: r, grow: r * 1.4, max: life * rr(0.8, 1.2), color, vx: vx + rr(-0.15, 0.15), vy: vy + rr(-0.15, 0.15), drag: 1.2, alpha, vr: rr(-0.6, 0.6) });
  }
  dust(x, y, r, n = 3, life = 0.8) {
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, v = rr(0.3, 1.2) * r;
      this.add(DUST, x, y, { size: r * rr(0.4, 0.8), grow: r * 1.2, max: life * rr(0.7, 1.2), vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: 3, color: "#8a7a62", alpha: 0.45 });
    }
  }
  fire(x, y, r, life = 0.45, vx = 0, vy = 0) {
    this.add(FIRE, x, y, { size: r, grow: r * 0.6, max: life * rr(0.7, 1.2), vx, vy, drag: 2.5, color: "#ff9a40", vr: rr(-2, 2) });
  }
  ring(x, y, r0, r1, color, life = 0.35, alpha = 0.8) {
    this.add(RING, x, y, { size: r0, grow: (r1 - r0) / life, max: life, color, alpha });
  }
  debris(x, y, n, color, speed = 3, size = 0.08) {
    n = Math.round(n * (this.busy > 0.6 ? 0.5 : 1));
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, v = speed * rr(0.3, 1);
      this.add(DEBRIS, x, y, { vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: rr(2, 5), z: 0.1, max: rr(0.9, 1.6), size: size * rr(0.5, 1.4), color, vr: rr(-12, 12), drag: 0.8 });
    }
  }
  embers(x, y, n, r) {
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, v = rr(0.5, 2.5) * r;
      this.add(EMBER, x, y, { vx: Math.cos(a) * v, vy: Math.sin(a) * v, max: rr(0.5, 1.2), size: rr(0.03, 0.06), color: "#ffb050", drag: 1.5 });
    }
  }
  heal(x, y) {
    for (let i = 0; i < 2; i++) this.add(HEAL, x + rr(-0.3, 0.3), y + rr(-0.3, 0.3), { vy: -0.5, max: 0.8, size: rr(0.08, 0.13), color: "#6dff9a" });
  }
  hex(x, y, r, hx, hy) {
    this.add(HEX, x, y, { size: r, max: 0.45, color: "#7fd8ff", vx: hx, vy: hy, alpha: 1 });
  }
  bolt(x, y, r, color, life = 0.25) {
    this.add(BOLT, x, y, { size: r, max: life, color, vr: rr(-3, 3) });
  }
  beam(kind, pts, color, width, life) {
    if (this.beams.length > 400) this.beams.shift();
    this.beams.push({ kind, pts, life, max: life, color, width, seed: rnd() * 1e6 | 0 });
  }
  /** A sized explosion. style picks colours/shape. */
  boom(x, y, r, style = "fire", ground = true) {
    r = Math.max(0.15, r);
    const q = this.busy > 0.6 ? 0.5 : 1;
    if (style === "emp") {
      this.glow(x, y, r * 1.8, "#9fd0ff", 0.25);
      this.ring(x, y, r * 0.2, r * 1.3, "#a8d8ff", 0.35);
      for (let i = 0; i < 3; i++) this.bolt(x + rr(-r, r) * 0.5, y + rr(-r, r) * 0.5, r * rr(0.7, 1.1), "#bfe4ff", rr(0.2, 0.4));
      this.sparks(x, y, 12 * q, "#cfe9ff", 5 * r);
      return;
    }
    if (style === "plasma") {
      this.glow(x, y, r * 2, "#e070ff", 0.3);
      this.glow(x, y, r * 0.9, "#ffffff", 0.12);
      this.ring(x, y, r * 0.2, r * 1.4, "#e070ff", 0.3);
      this.sparks(x, y, 14 * q, "#f0a0ff", 5 * r);
      for (let i = 0; i < 3; i++) this.smoke(x, y, r * 0.5, 1, "#2a1830");
      if (ground) this.decal("scorch", x, y, r * 0.7);
      return;
    }
    if (style === "sonic") {
      this.ring(x, y, r * 0.2, r * 1.6, "#5ec8ff", 0.3, 0.9);
      this.ring(x, y, r * 0.1, r * 1.1, "#bfefff", 0.22, 0.7);
      this.dust(x, y, r * 0.8, 5);
      return;
    }
    if (style === "flak") {
      this.glow(x, y, r * 1.1, "#ffd080", 0.12);
      this.star(x, y, r * 0.9, "#ffe0a0", rnd() * 6, 0.1);
      this.sparks(x, y, 18 * q, "#ffb333", 4 * r, void 0, Math.PI, 0.25);
      for (let i = 0; i < 3; i++) this.smoke(x + rr(-0.2, 0.2) * r, y + rr(-0.2, 0.2) * r, r * 0.45, 1.2, "#3a2c22", 0, 0, 0.55);
      return;
    }
    const big = style === "big" || r > 1.4;
    this.glow(x, y, r * 2.4, "#ffb060", 0.18, 0.9);
    this.glow(x, y, r * 1, "#ffffff", 0.08);
    const nf = Math.round((4 + r * 5) * q);
    for (let i = 0; i < nf; i++) {
      const a = rnd() * Math.PI * 2, d = rnd() * r * 0.5, v = rr(0.5, 1.6) * r;
      this.fire(x + Math.cos(a) * d, y + Math.sin(a) * d, r * rr(0.4, 0.75), rr(0.35, 0.6) * (big ? 1.4 : 1), Math.cos(a) * v, Math.sin(a) * v);
    }
    this.sparks(x, y, (8 + r * 8) * q, "#ffcf70", 6 * Math.sqrt(r), void 0, Math.PI, 0.35);
    if (r >= 0.5) this.ring(x, y, r * 0.3, r * 1.7, "#ffd8a0", 0.3, 0.55);
    const ns = Math.round((2 + r * 3) * q);
    for (let i = 0; i < ns; i++) this.smoke(x + rr(-0.4, 0.4) * r, y + rr(-0.4, 0.4) * r, r * rr(0.4, 0.7), rr(1.2, 2.2) * (big ? 1.4 : 1), "#24201c", 0, 0, 0.55);
    if (style === "napalm") {
      this.embers(x, y, 8 * q, r);
      for (let i = 0; i < 3; i++) this.schedule(0.15 + i * 0.25, () => {
        for (let k = 0; k < 3; k++) this.fire(x + rr(-0.6, 0.6) * r, y + rr(-0.6, 0.6) * r, r * 0.35, 0.6);
      });
    }
    if (ground) {
      this.dust(x, y, r * 0.7, 3);
      this.decal(r > 0.7 ? "crater" : "scorch", x, y, r * 0.75);
      if (style === "napalm") this.decal("burn", x, y, r * 0.9);
    }
    if (big) this.debris(x, y, Math.round(r * 3), "#2a2622", 3 * r, 0.06);
  }
  /* ------------------------------------------------------------------------------------------ decals */
  setDecalSpace(fieldW, fieldH, px) {
    px = Math.max(4, Math.round(px));
    if (this.decalCanvas && px === this.decalPx && fieldW === this.fieldW && fieldH === this.fieldH) return;
    this.decalPx = px;
    this.fieldW = fieldW;
    this.fieldH = fieldH;
    this.decalCanvas = makeCanvas(fieldW * px, fieldH * px);
    for (const d of this.decals) this.paintDecal(d);
  }
  decal(kind, x, y, r, img, ext, a = rnd() * Math.PI * 2) {
    const d = { kind, x, y, r, a, img, ext };
    this.decals.push(d);
    if (this.decals.length > 500) {
      const i = this.decals.findIndex((q) => q.kind !== "wreck");
      this.decals.splice(i >= 0 ? i : 0, 1);
    }
    this.paintDecal(d);
  }
  paintDecal(d) {
    const c = this.decalCanvas;
    if (!c) return;
    const g = ctx2d(c);
    const px = this.decalPx;
    g.setTransform(px, 0, 0, px, 0, 0);
    if (d.kind === "wreck" && d.img && d.ext) {
      g.save();
      g.translate(d.x, d.y);
      g.rotate(d.a);
      g.globalAlpha = 0.95;
      g.drawImage(d.img, -d.ext, -d.ext, d.ext * 2, d.ext * 2);
      g.restore();
      g.globalAlpha = 1;
      return;
    }
    const r = d.r;
    if (d.kind === "burn") {
      const t = tinted("burn", "#3a1a08");
      g.globalAlpha = 0.5;
      if (t) g.drawImage(t, d.x - r, d.y - r, r * 2, r * 2);
      g.globalAlpha = 1;
      return;
    }
    const gr = g.createRadialGradient(d.x, d.y, 0, d.x, d.y, r * 1.3);
    gr.addColorStop(0, d.kind === "crater" ? "rgba(8,7,6,0.6)" : "rgba(10,9,8,0.45)");
    gr.addColorStop(0.5, "rgba(14,12,10,0.3)");
    gr.addColorStop(1, "rgba(14,12,10,0)");
    g.fillStyle = gr;
    g.beginPath();
    g.arc(d.x, d.y, r * 1.3, 0, Math.PI * 2);
    g.fill();
    if (d.kind === "crater") {
      g.strokeStyle = "rgba(150,130,100,0.18)";
      g.lineWidth = r * 0.12;
      g.beginPath();
      g.arc(d.x, d.y, r * 0.55, d.a, d.a + 4);
      g.stroke();
      g.fillStyle = "rgba(0,0,0,0.35)";
      g.beginPath();
      g.arc(d.x, d.y, r * 0.4, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "rgba(10,8,6,0.14)";
      g.lineWidth = r * 0.1;
      g.beginPath();
      for (let i = 0; i < 7; i++) {
        const a = d.a + i * 0.9 + Math.sin(i * 3.1) * 0.3;
        g.moveTo(d.x + Math.cos(a) * r * 0.5, d.y + Math.sin(a) * r * 0.5);
        g.lineTo(d.x + Math.cos(a) * r * 1.25, d.y + Math.sin(a) * r * 1.25);
      }
      g.stroke();
    }
  }
  /* ------------------------------------------------------------------------------------------ update */
  update(dt) {
    this.time += dt;
    if (this.later.length) {
      const due = this.later.filter((l) => l.t <= this.time);
      if (due.length) {
        this.later = this.later.filter((l) => l.t > this.time);
        for (const l of due) l.fn();
      }
    }
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const P = this.parts;
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i];
      p.life -= dt;
      if (p.life <= 0) {
        P[i] = P[P.length - 1];
        P.pop();
        continue;
      }
      const dr = Math.exp(-p.drag * dt);
      p.vx *= dr;
      p.vy *= dr;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      p.size += p.grow * dt;
      if (p.k === DEBRIS) {
        p.vz -= 14 * dt;
        p.z += p.vz * dt;
        if (p.z <= 0) {
          p.z = 0;
          if (p.vz < -1.5) p.vz = -p.vz * 0.3;
          else {
            p.vz = 0;
            p.vx *= 0.8;
            p.vy *= 0.8;
            p.vr *= 0.8;
          }
        }
      }
    }
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.life -= dt;
      if (b.life <= 0) this.beams.splice(i, 1);
    }
  }
  /* ------------------------------------------------------------------------------------------- draw */
  /** liftX/liftY: world vector for "screen up" (debris height). px = device pixels per cell. */
  draw(g, px, liftX, liftY) {
    const minW = 1 / px;
    for (const p of this.parts) {
      const t = p.life / p.max;
      if (p.k === DUST || p.k === SMOKE) {
        const a = p.alpha * Math.min(1, t * 1.6) * (p.k === SMOKE ? Math.min(1, (1 - t) * 6 + 0.3) : 1);
        g.globalAlpha = clamp(a, 0, 1);
        const img = p.k === SMOKE ? tinted("smoke", p.color) ?? softDot(rgba(p.color, 0.8)) : softDot(rgba(p.color, 0.7));
        const s = p.size;
        if (p.k === SMOKE) {
          const cs = Math.cos(p.rot), sn = Math.sin(p.rot);
          const tr = g.getTransform();
          g.transform(cs, sn, -sn, cs, p.x, p.y);
          g.drawImage(img, -s, -s, s * 2, s * 2);
          g.setTransform(tr);
        } else g.drawImage(img, p.x - s, p.y - s, s * 2, s * 2);
      } else if (p.k === DEBRIS) {
        g.globalAlpha = Math.min(1, t * 3);
        const x = p.x + liftX * p.z, y = p.y + liftY * p.z;
        const cs = Math.cos(p.rot), sn = Math.sin(p.rot);
        const tr = g.getTransform();
        g.transform(cs, sn, -sn, cs, x, y);
        g.fillStyle = p.color;
        g.fillRect(-p.size, -p.size * 0.6, p.size * 2, p.size * 1.2);
        g.setTransform(tr);
      }
    }
    g.globalAlpha = 1;
    const prev = g.globalCompositeOperation;
    g.globalCompositeOperation = "lighter";
    this.drawBeams(g, minW);
    for (const p of this.parts) {
      const t = p.life / p.max;
      switch (p.k) {
        case SPARK: {
          g.globalAlpha = Math.min(1, t * 2);
          g.strokeStyle = p.color;
          g.lineWidth = Math.max(minW, p.size);
          g.beginPath();
          g.moveTo(p.x, p.y);
          g.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04);
          g.stroke();
          break;
        }
        case FIRE: {
          const a = t > 0.8 ? (1 - t) * 5 : t * 1.25;
          g.globalAlpha = clamp(a, 0, 1);
          const img = tex("fireball") ?? softDot("rgba(255,140,50,0.9)");
          const s = p.size;
          const cs = Math.cos(p.rot), sn = Math.sin(p.rot);
          const tr = g.getTransform();
          g.transform(cs, sn, -sn, cs, p.x, p.y);
          g.drawImage(img, -s, -s, s * 2, s * 2);
          g.setTransform(tr);
          break;
        }
        case GLOW: {
          g.globalAlpha = p.alpha * t * t;
          const s = p.size;
          g.drawImage(softDot(p.color), p.x - s, p.y - s, s * 2, s * 2);
          break;
        }
        case STAR: {
          g.globalAlpha = t;
          const img = tinted("spark", p.color);
          const s = p.size;
          if (img) {
            const cs = Math.cos(p.rot), sn = Math.sin(p.rot);
            const tr = g.getTransform();
            g.transform(cs, sn, -sn, cs, p.x, p.y);
            g.drawImage(img, -s, -s, s * 2, s * 2);
            g.setTransform(tr);
          } else g.drawImage(softDot(p.color, 0.2), p.x - s * 0.6, p.y - s * 0.6, s * 1.2, s * 1.2);
          break;
        }
        case RING: {
          g.globalAlpha = p.alpha * t;
          const img = tinted("shockwave", p.color);
          const s = p.size;
          if (img) g.drawImage(img, p.x - s, p.y - s, s * 2, s * 2);
          else {
            g.strokeStyle = p.color;
            g.lineWidth = Math.max(minW, s * 0.08);
            g.beginPath();
            g.arc(p.x, p.y, s * 0.9, 0, Math.PI * 2);
            g.stroke();
          }
          break;
        }
        case EMBER: {
          g.globalAlpha = t;
          const s = p.size * 2;
          g.drawImage(softDot(p.color, 0.3), p.x - s, p.y - s, s * 2, s * 2);
          break;
        }
        case HEAL: {
          g.globalAlpha = Math.min(1, t * 2);
          g.fillStyle = p.color;
          const s = p.size;
          g.fillRect(p.x - s, p.y - s * 0.3, s * 2, s * 0.6);
          g.fillRect(p.x - s * 0.3, p.y - s, s * 0.6, s * 2);
          break;
        }
        case HEX: {
          g.globalAlpha = t * 0.9;
          const img = tinted("hex", p.color);
          const s = p.size;
          g.save();
          g.beginPath();
          g.arc(p.x, p.y, s, 0, Math.PI * 2);
          g.clip();
          if (img) g.drawImage(img, p.x - s, p.y - s, s * 2, s * 2);
          const gr = g.createRadialGradient(p.vx, p.vy, 0, p.vx, p.vy, s * (1.4 - t));
          gr.addColorStop(0, rgba("#bfefff", 0.8));
          gr.addColorStop(1, rgba("#7fd8ff", 0));
          g.fillStyle = gr;
          g.fillRect(p.x - s, p.y - s, s * 2, s * 2);
          g.restore();
          g.strokeStyle = rgba("#9fe4ff", 0.7);
          g.lineWidth = Math.max(minW, s * 0.04);
          g.beginPath();
          g.arc(p.x, p.y, s, 0, Math.PI * 2);
          g.stroke();
          break;
        }
        case BOLT: {
          g.globalAlpha = t;
          const img = tex("wbolt");
          const s = p.size;
          if (img) {
            const cs = Math.cos(p.rot + (this.time * 20 | 0) % 4 * 1.57), sn = Math.sin(p.rot + (this.time * 20 | 0) % 4 * 1.57);
            const tr = g.getTransform();
            g.transform(cs, sn, -sn, cs, p.x, p.y);
            g.drawImage(tinted("wbolt", p.color) ?? img, -s, -s, s * 2, s * 2);
            g.setTransform(tr);
          }
          break;
        }
      }
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = prev;
  }
  drawBeams(g, minW) {
    for (const b of this.beams) {
      const t = b.life / b.max;
      const fade = Math.pow(t, 1.5);
      const p = b.pts;
      const x1 = p[0], y1 = p[1], x2 = p[p.length - 2], y2 = p[p.length - 1];
      g.lineCap = "round";
      g.lineJoin = "round";
      switch (b.kind) {
        case "laser":
        case "sniper": {
          stroke(g, p, b.color, Math.max(minW * 3, b.width * 3 * (0.5 + 0.5 * t)), 0.35 * fade);
          stroke(g, p, "#ffffff", Math.max(minW, b.width * (0.5 + 0.5 * t)), fade);
          break;
        }
        case "plasma": {
          const w = b.width * (0.6 + 0.4 * t);
          stroke(g, p, b.color, Math.max(minW * 4, w * 4), 0.25 * fade);
          stroke(g, p, b.color, Math.max(minW * 2, w * 1.8), 0.7 * fade);
          stroke(g, p, "#ffe8ff", Math.max(minW, w * 0.6), fade);
          break;
        }
        case "heat": {
          const n = 10;
          const pts = [];
          for (let i = 0; i <= n; i++) {
            const f = i / n;
            const wob = Math.sin(f * 14 + this.time * 40 + b.seed) * 0.04 * f;
            const nx = -(y2 - y1), ny = x2 - x1, l = Math.hypot(nx, ny) || 1;
            pts.push(x1 + (x2 - x1) * f + nx / l * wob, y1 + (y2 - y1) * f + ny / l * wob);
          }
          const gr = g.createLinearGradient(x1, y1, x2, y2);
          gr.addColorStop(0, rgba("#ffff60", fade));
          gr.addColorStop(0.5, rgba("#ff6a1a", fade * 0.8));
          gr.addColorStop(1, rgba("#ff1a00", fade * 0.25));
          stroke(g, pts, "#ff3a00", Math.max(minW * 3, b.width * 3.5), 0.22 * fade);
          strokeStyle(g, pts, gr, Math.max(minW, b.width * 1.2));
          break;
        }
        case "slow": {
          const pts = wavy(x1, y1, x2, y2, 12, 0.06, this.time * 25 + b.seed);
          stroke(g, pts, "#8a00b0", Math.max(minW * 3, b.width * 4), 0.35 * fade);
          stroke(g, pts, b.color, Math.max(minW * 1.5, b.width * 1.6), 0.85 * fade);
          stroke(g, p, "#f0d8ff", Math.max(minW, b.width * 0.5), fade);
          break;
        }
        case "repair": {
          const pts = wavy(x1, y1, x2, y2, 10, 0.05, this.time * 18 + b.seed);
          stroke(g, pts, b.color, Math.max(minW * 2, b.width * 3), 0.3 * fade);
          stroke(g, pts, "#d8ffe4", Math.max(minW, b.width), 0.9 * fade);
          break;
        }
        case "scramble": {
          const pts = jag(x1, y1, x2, y2, 9, 0.12, b.seed + (this.time * 30 | 0));
          stroke(g, pts, b.color, Math.max(minW * 2.5, b.width * 3), 0.35 * fade);
          stroke(g, pts, "#ffffff", Math.max(minW, b.width * 0.8), fade);
          break;
        }
        case "gravity": {
          const pts = wavy(x1, y1, x2, y2, 14, 0.09, -this.time * 30 + b.seed);
          stroke(g, p, "#3a0066", Math.max(minW * 4, b.width * 5), 0.5 * fade);
          stroke(g, pts, b.color, Math.max(minW * 1.5, b.width * 1.4), 0.8 * fade);
          stroke(g, wavy(x1, y1, x2, y2, 14, -0.09, -this.time * 30 + b.seed), "#ff80ff", Math.max(minW, b.width * 0.6), 0.6 * fade);
          break;
        }
        case "rail": {
          const w = b.width * (0.3 + 0.7 * t);
          stroke(g, p, b.color, Math.max(minW * 5, w * 6), 0.25 * fade);
          stroke(g, p, b.color, Math.max(minW * 2, w * 2), 0.6 * fade);
          stroke(g, p, "#ffffff", Math.max(minW, w * 0.8), fade);
          const n = Math.max(6, Math.round(Math.hypot(x2 - x1, y2 - y1) * 3));
          const nx = -(y2 - y1), ny = x2 - x1, l = Math.hypot(nx, ny) || 1;
          g.fillStyle = b.color;
          g.globalAlpha = fade * 0.8;
          for (let i = 0; i < n; i++) {
            const f = i / n;
            const o = Math.sin(f * n * 1.3 + b.seed) * 0.12 * (1.5 - t);
            const s = Math.max(minW, 0.03);
            g.fillRect(x1 + (x2 - x1) * f + nx / l * o - s, y1 + (y2 - y1) * f + ny / l * o - s, s * 2, s * 2);
          }
          g.globalAlpha = 1;
          break;
        }
        case "lightning": {
          const pts = [];
          const reseed = b.seed + (this.time * 30 | 0);
          for (let i = 0; i + 3 < p.length; i += 2) {
            const seg = jag(p[i], p[i + 1], p[i + 2], p[i + 3], 8, 0.16, reseed + i * 31);
            for (let k = i === 0 ? 0 : 2; k < seg.length; k++) pts.push(seg[k]);
          }
          stroke(g, pts, b.color, Math.max(minW * 3, b.width * 4), 0.35 * fade);
          stroke(g, pts, "#ffffff", Math.max(minW, b.width), fade);
          if (t > 0.4) {
            for (let i = 4; i + 1 < pts.length; i += 6) {
              const a = (reseed * 0.37 + i) % 6.28;
              const fx = pts[i] + Math.cos(a) * 0.35, fy = pts[i + 1] + Math.sin(a) * 0.35;
              stroke(g, jag(pts[i], pts[i + 1], fx, fy, 3, 0.2, reseed + i), b.color, Math.max(minW, b.width * 0.6), 0.7 * fade);
            }
          }
          break;
        }
      }
    }
    g.globalAlpha = 1;
  }
};
function stroke(g, pts, color, w, a) {
  if (a <= 0.01) return;
  g.globalAlpha = clamp(a, 0, 1);
  g.strokeStyle = color;
  g.lineWidth = w;
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.stroke();
}
function strokeStyle(g, pts, style, w) {
  g.globalAlpha = 1;
  g.strokeStyle = style;
  g.lineWidth = w;
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.stroke();
}
function jag(x1, y1, x2, y2, n, amp, seed) {
  const out2 = [x1, y1];
  const dx = x2 - x1, dy = y2 - y1;
  const l = Math.hypot(dx, dy) || 1;
  const nx = -dy / l, ny = dx / l;
  let s = (seed | 0) * 2654435761;
  for (let i = 1; i < n; i++) {
    s = (s ^ s >>> 13) * 1274126177;
    const r = (s >>> 0) % 1e3 / 1e3 - 0.5;
    const f = i / n;
    const o = r * amp * Math.min(l, 3) * 2 * Math.sin(f * Math.PI);
    out2.push(x1 + dx * f + nx * o, y1 + dy * f + ny * o);
  }
  out2.push(x2, y2);
  return out2;
}
function wavy(x1, y1, x2, y2, n, amp, phase) {
  const out2 = [];
  const dx = x2 - x1, dy = y2 - y1;
  const l = Math.hypot(dx, dy) || 1;
  const nx = -dy / l, ny = dx / l;
  const waves = Math.max(1, l * 1.5);
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const o = Math.sin(f * waves * Math.PI * 2 + phase) * amp * Math.sin(f * Math.PI);
    out2.push(x1 + dx * f + nx * o, y1 + dy * f + ny * o);
  }
  return out2;
}

// src/client/render/ground.ts
var noiseTile = null;
function getNoise() {
  if (noiseTile) return noiseTile;
  const n = 128;
  noiseTile = makeCanvas(n, n);
  const g = ctx2d(noiseTile);
  const im = g.createImageData(n, n);
  let s = 12345;
  for (let i = 0; i < n * n; i++) {
    s = s * 1103515245 + 12345 & 2147483647;
    const v = s >> 8 & 255;
    const k = v > 128 ? 255 : 0;
    im.data[i * 4] = k;
    im.data[i * 4 + 1] = k;
    im.data[i * 4 + 2] = k;
    im.data[i * 4 + 3] = Math.abs(v - 128) * 0.18;
  }
  g.putImageData(im, 0, 0);
  return noiseTile;
}
var cache = /* @__PURE__ */ new Map();
function groundCanvas(px) {
  px = Math.max(4, Math.round(px));
  let c = cache.get(px);
  if (c) return c;
  if (cache.size > 4) cache.clear();
  c = makeCanvas(FIELD_W * px, FIELD_H * px);
  const g = ctx2d(c);
  paint(g, px, 0, 0, c.width, c.height);
  cache.set(px, c);
  return c;
}
function groundRegion(px, x0, y0, x1, y1) {
  const c = makeCanvas(Math.max(1, Math.ceil((x1 - x0) * px)), Math.max(1, Math.ceil((y1 - y0) * px)));
  paint(ctx2d(c), px, x0, y0, c.width, c.height);
  return c;
}
function paint(g, px, x0, y0, cw, ch) {
  const T = () => g.setTransform(px, 0, 0, px, -x0 * px, -y0 * px);
  let seed = 9001;
  const rnd3 = () => (seed = seed * 16807 % 2147483647) / 2147483647;
  const W = FIELD_W, H = FIELD_H;
  T();
  const base2 = g.createLinearGradient(0, 0, W, H);
  base2.addColorStop(0, "#363a37");
  base2.addColorStop(0.5, "#313432");
  base2.addColorStop(1, "#383934");
  g.fillStyle = base2;
  g.fillRect(0, 0, W, H);
  const P = 5;
  for (let y = 0; y < H; y += P) for (let x = 0; x < W; x += P) {
    const v = rnd3();
    g.fillStyle = v < 0.33 ? "rgba(255,255,255,0.025)" : v < 0.66 ? "rgba(0,0,0,0.05)" : "rgba(90,80,60,0.05)";
    g.fillRect(x + 0.03, y + 0.03, P - 0.06, P - 0.06);
  }
  for (let i = 0; i < 90; i++) {
    const x = rnd3() * W, y = rnd3() * H, r = 0.8 + rnd3() * 3.5;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const dusty = rnd3() < 0.6;
    gr.addColorStop(0, dusty ? `rgba(120,104,78,${0.05 + rnd3() * 0.07})` : `rgba(0,0,0,${0.06 + rnd3() * 0.08})`);
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  const pat = g.createPattern(getNoise(), "repeat");
  if (pat) {
    g.fillStyle = pat;
    g.globalAlpha = 0.55;
    g.fillRect(0, 0, cw, ch);
    g.globalAlpha = 1;
  }
  T();
  const lw2 = 1 / px;
  g.lineWidth = lw2 * 1.5;
  g.strokeStyle = "rgba(0,0,0,0.35)";
  g.beginPath();
  for (let x = P; x < W; x += P) {
    g.moveTo(x, 0);
    g.lineTo(x, H);
  }
  for (let y = P; y < H; y += P) {
    g.moveTo(0, y);
    g.lineTo(W, y);
  }
  g.stroke();
  g.strokeStyle = "rgba(255,255,255,0.05)";
  g.beginPath();
  for (let x = P; x < W; x += P) {
    g.moveTo(x + lw2 * 1.5, 0);
    g.lineTo(x + lw2 * 1.5, H);
  }
  for (let y = P; y < H; y += P) {
    g.moveTo(0, y + lw2 * 1.5);
    g.lineTo(W, y + lw2 * 1.5);
  }
  g.stroke();
  for (let y = P; y < H; y += P) for (let x = P; x < W; x += P) {
    for (const [dx, dy] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) {
      g.fillStyle = "rgba(0,0,0,0.4)";
      g.beginPath();
      g.arc(x + dx, y + dy, 0.045, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "rgba(255,255,255,0.09)";
      g.beginPath();
      g.arc(x + dx - 0.012, y + dy - 0.012, 0.022, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.strokeStyle = "rgba(255,255,255,0.04)";
  g.lineWidth = lw2;
  g.beginPath();
  for (let x = 1; x < W; x++) if (x % 5) {
    g.moveTo(x, 0);
    g.lineTo(x, H);
  }
  for (let y = 1; y < H; y++) if (y % 5) {
    g.moveTo(0, y);
    g.lineTo(W, y);
  }
  g.stroke();
  g.strokeStyle = "rgba(255,255,255,0.085)";
  g.lineWidth = lw2 * 1.4;
  g.beginPath();
  for (let x = 5; x < W; x += 5) {
    g.moveTo(x, 0);
    g.lineTo(x, H);
  }
  for (let y = 5; y < H; y += 5) {
    g.moveTo(0, y);
    g.lineTo(W, y);
  }
  g.stroke();
  g.strokeStyle = "rgba(0,0,0,0.3)";
  g.lineWidth = lw2 * 1.2;
  for (let i = 0; i < 14; i++) {
    let x = rnd3() * W, y = DEPLOY_D + rnd3() * (H - 2 * DEPLOY_D);
    let a = rnd3() * Math.PI * 2;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 6; k++) {
      a += (rnd3() - 0.5) * 1.4;
      x += Math.cos(a) * 0.4;
      y += Math.sin(a) * 0.4;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  for (let i = 0; i < 9; i++) {
    const x = 1 + rnd3() * (W - 2), y = DEPLOY_D + 1 + rnd3() * (H - 2 * DEPLOY_D - 2), r = 0.3 + rnd3() * 0.7;
    const gr = g.createRadialGradient(x, y, 0, x, y, r * 1.4);
    gr.addColorStop(0, "rgba(0,0,0,0.3)");
    gr.addColorStop(0.6, "rgba(0,0,0,0.12)");
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr;
    g.beginPath();
    g.arc(x, y, r * 1.4, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(160,140,110,0.05)";
    g.lineWidth = r * 0.12;
    g.beginPath();
    g.arc(x, y, r * 0.75, 3.6, 5.8);
    g.stroke();
  }
  const mid = H / 2;
  g.strokeStyle = "rgba(255,255,255,0.06)";
  g.lineWidth = lw2 * 2;
  g.setLineDash([0.4, 0.4]);
  g.beginPath();
  g.moveTo(0, mid);
  g.lineTo(W, mid);
  g.stroke();
  g.setLineDash([]);
  g.setTransform(1, 0, 0, 1, 0, 0);
}

// src/client/render/turrets.ts
function visualGlow(v, pal) {
  switch (v) {
    case "laser":
      return pal.glow;
    case "heatray":
      return "#ff7a2a";
    case "plasma":
      return "#e070ff";
    case "rail":
    case "gauss":
      return "#9fe8ff";
    case "tesla":
    case "emp":
      return "#a8d8ff";
    case "slowbeam":
      return "#b47cff";
    case "repair":
      return "#6dff9a";
    case "shield":
      return "#7fd8ff";
    case "flamer":
      return "#ffa040";
    case "sonic":
      return "#5ec8ff";
    case "gravity":
      return "#b070ff";
    case "blade":
      return pal.glow;
    case "pointdef":
      return "#ff6060";
    case "prod":
      return "#a8d8ff";
    default:
      return "#ffd27a";
  }
}
function moduleGlow(m, pal) {
  switch (m?.id) {
    case "laser":
      return "#ff4058";
    case "twinlaser":
      return "#ff5ab0";
    case "disarm":
      return "#ffe84a";
    case "empcannon":
      return "#5aa0ff";
    case "stungun":
      return "#cfeaff";
    case "plasmaorb":
      return "#ff60e0";
    case "pointdef":
      return "#ff6060";
  }
  return visualGlow(m?.visual, pal);
}
function muzzleLen(m) {
  if (!m) return 0.8;
  const c = m.caliber ?? 0.5;
  switch (m.visual) {
    case "gun":
      return 0.95 + c * 0.45;
    case "gatling":
      return 1.05;
    case "shotgun":
      return 0.9;
    case "cannon":
      return 1.25;
    case "gauss":
      return 1.3;
    case "sniper":
      return 1.45;
    case "rail":
      return 1.4;
    case "artillery":
      return (m.barrels ?? 1) > 1 ? 1.2 : 1.5;
    case "laser":
      return 0.95;
    case "heatray":
      return 0.6;
    case "plasma":
      return 1.1;
    case "flamer":
      return 0.85;
    case "tesla":
      return 0.25;
    case "emp":
      return 0.75;
    case "slowbeam":
      return 0.7;
    case "flak":
      return 0.95;
    case "repair":
      return 0.6;
    case "mortar":
      return 0.25;
    case "sonic":
      return 1.3;
    case "saw":
      return 1.3;
    case "chainsaw":
      return 2;
    case "hammer":
      return 1.5;
    case "claw":
      return 1.6;
    case "blade":
      return 2;
    case "drill":
      return 1.9;
    case "prod":
      return 1.85;
    case "ram":
      return 1.2;
    case "pointdef":
      return 0.7;
    case "gravity":
      return 1.1;
    case "rocketPod":
    case "missileRack":
    case "cruise":
      return 0.6;
    default:
      return 0.6;
  }
}
var TURRET_EXT = 1.75;
var lw = (g, w) => {
  g.lineWidth = w;
};
function shape(g, fill, outline, path) {
  g.beginPath();
  path();
  g.fillStyle = fill;
  g.fill();
  if (outline > 0) {
    lw(g, outline);
    g.strokeStyle = OUTLINE;
    g.stroke();
  }
}
function barrel(g, x0, x1, y, w, o, color = METAL.base) {
  shape(g, color, o, () => roundRect(g, x0, y - w / 2, x1 - x0, w, w * 0.3));
  g.fillStyle = "rgba(255,255,255,0.28)";
  g.fillRect(x0 + w * 0.3, y - w * 0.32, x1 - x0 - w * 0.6, w * 0.22);
}
function muzzle(g, x, y, w, len, o) {
  shape(g, METAL.dark, o, () => roundRect(g, x - len, y - w / 2, len, w, w * 0.2));
}
function teamGrad(g, pal, r) {
  const gr = g.createLinearGradient(-r, -r, r, r);
  gr.addColorStop(0, shade(pal.light, 0.3));
  gr.addColorStop(0.5, shade(pal.light, -0.05));
  gr.addColorStop(1, shade(pal.body, -0.1));
  return gr;
}
function metalGrad(g, r, base2 = METAL.base) {
  const gr = g.createLinearGradient(-r, -r, r, r);
  gr.addColorStop(0, shade(base2, 0.35));
  gr.addColorStop(0.6, base2);
  gr.addColorStop(1, shade(base2, -0.45));
  return gr;
}
function hatch(g, x, y, r, o) {
  shape(g, METAL.dark, o * 0.6, () => g.arc(x, y, r, 0, Math.PI * 2));
  g.fillStyle = "rgba(255,255,255,0.18)";
  g.beginPath();
  g.arc(x - r * 0.25, y - r * 0.25, r * 0.45, 0, Math.PI * 2);
  g.fill();
}
function glowDot(g, x, y, r, color) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r * 2.4);
  gr.addColorStop(0, "#ffffff");
  gr.addColorStop(0.25, color);
  gr.addColorStop(1, rgba(color.length === 7 ? color : "#ffffff", 0));
  g.fillStyle = gr;
  g.beginPath();
  g.arc(x, y, r * 2.4, 0, Math.PI * 2);
  g.fill();
}
function rivets(g, pts, r) {
  g.fillStyle = "rgba(0,0,0,0.45)";
  for (let i = 0; i < pts.length; i += 2) {
    g.beginPath();
    g.arc(pts[i], pts[i + 1], r, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = "rgba(255,255,255,0.25)";
  for (let i = 0; i < pts.length; i += 2) {
    g.beginPath();
    g.arc(pts[i] - r * 0.3, pts[i + 1] - r * 0.3, r * 0.5, 0, Math.PI * 2);
    g.fill();
  }
}
function joint(g, x, y, r, o) {
  shape(g, METAL.dark, o * 0.6, () => g.arc(x, y, r, 0, Math.PI * 2));
}
function vents2(g, x, y, w, h, n, o) {
  shape(g, "rgba(0,0,0,0.5)", 0, () => roundRect(g, x - w / 2, y - h / 2, w, h, w * 0.1));
  g.strokeStyle = "rgba(255,255,255,0.2)";
  lw(g, o * 0.4);
  g.beginPath();
  for (let i = 1; i < n; i++) {
    const yy = y - h / 2 + h * i / n;
    g.moveTo(x - w * 0.4, yy);
    g.lineTo(x + w * 0.4, yy);
  }
  g.stroke();
}
function housing(g, pal, x, y, w, h, rad, o) {
  shape(g, teamGrad(g, pal, Math.max(w, h) / 2), o, () => roundRect(g, x, y, w, h, rad));
}
function drum(g, x, y, r, o) {
  shape(g, METAL.dark, o, () => g.arc(x, y, r, 0, Math.PI * 2));
  g.strokeStyle = "rgba(255,255,255,0.25)";
  lw(g, r * 0.15);
  g.beginPath();
  g.arc(x, y, r * 0.6, 0, Math.PI * 2);
  g.stroke();
}
function lyingMissile(g, x, y, len, w, nose, o) {
  shape(g, "#e4e2da", o * 0.5, () => roundRect(g, x, y - w / 2, len, w, w / 2));
  g.fillStyle = nose;
  g.beginPath();
  g.moveTo(x + len, y);
  g.lineTo(x + len - w * 1.2, y - w / 2);
  g.lineTo(x + len - w * 1.2, y + w / 2);
  g.closePath();
  g.fill();
  g.fillStyle = "#8b8b84";
  g.beginPath();
  g.moveTo(x, y - w * 0.95);
  g.lineTo(x + w * 0.9, y - w * 0.4);
  g.lineTo(x + w * 0.9, y + w * 0.4);
  g.lineTo(x, y + w * 0.95);
  g.closePath();
  g.fill();
}
function cellGrid(g, pal, cols, rows, cell, o, lid) {
  const w = cols * cell, h = rows * cell, x0 = -w / 2 + cell * 0.2;
  housing(g, pal, x0 - cell * 0.18, -h / 2 - cell * 0.18, w + cell * 0.36, h + cell * 0.36, cell * 0.25, o);
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const cx = x0 + j * cell, cy = -h / 2 + i * cell;
    shape(g, METAL.dark, o * 0.4, () => roundRect(g, cx + cell * 0.08, cy + cell * 0.08, cell * 0.84, cell * 0.84, cell * 0.12));
    shape(g, lid, 0, () => roundRect(g, cx + cell * 0.22, cy + cell * 0.22, cell * 0.56, cell * 0.56, cell * 0.1));
  }
}
function hazard(g, x, y, w, h) {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.fillStyle = "#f0c020";
  g.fillRect(x, y, w, h);
  g.strokeStyle = "#151515";
  lw(g, Math.min(w, h) * 0.22);
  g.beginPath();
  for (let i = -6; i < 12; i++) {
    const xx = x + i * Math.min(w, h) * 0.45;
    g.moveTo(xx, y + h);
    g.lineTo(xx + h, y);
  }
  g.stroke();
  g.restore();
}
function drawSpecial(g, m, pal, r, o, glow) {
  switch (m.id) {
    case "mg": {
      barrel(g, 0, r * 1.75, 0, r * 0.13, o);
      shape(g, METAL.dark, o * 0.5, () => roundRect(g, r * 1.55, -r * 0.1, r * 0.22, r * 0.2, r * 0.05));
      housing(g, pal, -r * 0.7, -r * 0.5, r * 1.15, r * 1, r * 0.3, o);
      shape(g, METAL.dark, o * 0.5, () => roundRect(g, -r * 0.45, r * 0.5, r * 0.5, r * 0.3, r * 0.06));
      return true;
    }
    case "twinmg": {
      for (const y of [-0.24, 0.24]) barrel(g, 0, r * 1.75, y * r, r * 0.13, o);
      housing(g, pal, -r * 0.75, -r * 0.62, r * 1.25, r * 1.24, r * 0.3, o);
      shape(g, METAL.dark, o * 0.5, () => roundRect(g, r * 0.3, -r * 0.4, r * 0.2, r * 0.8, r * 0.05));
      return true;
    }
    case "hmg": {
      barrel(g, 0, r * 1.95, 0, r * 0.24, o);
      shape(g, METAL.dark, o * 0.6, () => roundRect(g, r * 1.75, -r * 0.2, r * 0.32, r * 0.4, r * 0.06));
      g.fillStyle = METAL.deep;
      g.fillRect(r * 1.82, -r * 0.2, r * 0.05, r * 0.4);
      g.fillRect(r * 1.95, -r * 0.2, r * 0.05, r * 0.4);
      shape(g, METAL.base, o * 0.6, () => roundRect(g, r * 0.6, -r * 0.18, r * 0.5, r * 0.36, r * 0.08));
      housing(g, pal, -r * 0.8, -r * 0.6, r * 1.4, r * 1.2, r * 0.25, o);
      shape(g, "#4a5a3a", o * 0.6, () => roundRect(g, -r * 0.55, r * 0.35, r * 0.75, r * 0.55, r * 0.06));
      g.fillStyle = "#c9a040";
      for (let i = 0; i < 4; i++) g.fillRect(-r * 0.45 + i * r * 0.16, r * 0.25, r * 0.08, r * 0.14);
      return true;
    }
    case "ac20": {
      barrel(g, 0, r * 1.35, 0, r * 0.3, o);
      muzzle(g, r * 1.5, 0, r * 0.38, r * 0.22, o * 0.6);
      housing(g, pal, -r * 0.8, -r * 0.65, r * 1.35, r * 1.3, r * 0.35, o);
      drum(g, -r * 0.2, r * 0, r * 0.42, o);
      return true;
    }
    case "autocannon": {
      barrel(g, 0, r * 2.05, 0, r * 0.26, o);
      shape(g, METAL.dark, o * 0.6, () => roundRect(g, r * 1.85, -r * 0.2, r * 0.42, r * 0.4, r * 0.08));
      g.fillStyle = METAL.deep;
      for (let i = 0; i < 3; i++) g.fillRect(r * (1.92 + i * 0.11), -r * 0.2, r * 0.04, r * 0.4);
      housing(g, pal, -r * 0.9, -r * 0.75, r * 1.65, r * 1.5, r * 0.3, o);
      shape(g, METAL.dark, o * 0.6, () => roundRect(g, r * 0.5, -r * 0.4, r * 0.3, r * 0.8, r * 0.08));
      hatch(g, -r * 0.4, -r * 0.3, r * 0.24, o);
      return true;
    }
    case "twin30": {
      for (const y of [-0.38, 0.38]) {
        barrel(g, 0, r * 2, y * r, r * 0.24, o);
        shape(g, METAL.dark, o * 0.6, () => roundRect(g, r * 1.82, y * r - r * 0.18, r * 0.36, r * 0.36, r * 0.07));
      }
      housing(g, pal, -r * 0.95, -r * 0.9, r * 1.75, r * 1.8, r * 0.3, o);
      shape(g, METAL.dark, o * 0.6, () => roundRect(g, r * 0.55, -r * 0.65, r * 0.3, r * 1.3, r * 0.08));
      hatch(g, -r * 0.45, 0, r * 0.28, o);
      return true;
    }
    case "ac40": {
      shape(g, METAL.dark, o, () => g.arc(-r * 0.1, 0, r * 0.95, 0, Math.PI * 2));
      shape(g, METAL.base, o * 0.6, () => g.arc(-r * 0.1, 0, r * 0.75, 0, Math.PI * 2));
      barrel(g, -r * 0.3, r * 2.3, 0, r * 0.26, o);
      shape(g, METAL.light, o * 0.7, () => {
        g.moveTo(r * 2.2, -r * 0.14);
        g.lineTo(r * 2.65, -r * 0.3);
        g.lineTo(r * 2.65, r * 0.3);
        g.lineTo(r * 2.2, r * 0.14);
        g.closePath();
      });
      shape(g, teamGrad(g, pal, r), o, () => {
        g.moveTo(r * 0.35, -r * 0.85);
        g.lineTo(r * 0.6, -r * 0.3);
        g.lineTo(r * 0.6, r * 0.3);
        g.lineTo(r * 0.35, r * 0.85);
        g.lineTo(r * 0.15, r * 0.8);
        g.lineTo(r * 0.3, 0);
        g.lineTo(r * 0.15, -r * 0.8);
        g.closePath();
      });
      shape(g, "#c9a040", o * 0.5, () => roundRect(g, -r * 0.55, -r * 0.18, r * 0.5, r * 0.36, r * 0.05));
      return true;
    }
    case "quad20": {
      for (const y of [-0.62, -0.22, 0.22, 0.62]) barrel(g, 0, r * 1.75, y * r, r * 0.17, o);
      for (const y of [-0.62, -0.22, 0.22, 0.62]) shape(g, METAL.dark, o * 0.4, () => roundRect(g, r * 1.65, y * r - r * 0.12, r * 0.2, r * 0.24, r * 0.04));
      housing(g, pal, -r * 0.95, -r * 0.95, r * 1.6, r * 1.9, r * 0.3, o);
      shape(g, metalGrad(g, r * 0.5, METAL.light), o * 0.7, () => g.ellipse(-r * 0.45, 0, r * 0.28, r * 0.62, 0, 0, Math.PI * 2));
      g.strokeStyle = METAL.dark;
      lw(g, r * 0.06);
      g.beginPath();
      g.moveTo(-r * 0.45, -r * 0.55);
      g.lineTo(-r * 0.45, r * 0.55);
      g.moveTo(-r * 0.45, 0);
      g.lineTo(-r * 0.05, 0);
      g.stroke();
      glowDot(g, -r * 0.05, 0, r * 0.06, "#ff5050");
      return true;
    }
    case "cannon75": {
      barrel(g, 0, r * 2.1, 0, r * 0.26, o);
      shape(g, METAL.dark, o * 0.6, () => roundRect(g, r * 2, -r * 0.18, r * 0.25, r * 0.36, r * 0.1));
      shape(g, teamGrad(g, pal, r), o, () => g.ellipse(-r * 0.1, 0, r * 0.95, r * 0.82, 0, 0, Math.PI * 2));
      shape(g, METAL.dark, o * 0.6, () => roundRect(g, r * 0.55, -r * 0.3, r * 0.3, r * 0.6, r * 0.1));
      hatch(g, -r * 0.4, -r * 0.25, r * 0.26, o);
      return true;
    }
    case "atgm": {
      shape(g, "#5a6a4a", o, () => roundRect(g, -r * 0.5, -r * 0.24, r * 2.2, r * 0.48, r * 0.22));
      shape(g, METAL.deep, 0, () => g.ellipse(r * 1.68, 0, r * 0.07, r * 0.2, 0, 0, Math.PI * 2));
      g.fillStyle = "#c0392b";
      g.fillRect(r * 1.35, -r * 0.24, r * 0.12, r * 0.48);
      housing(g, pal, -r * 0.85, -r * 0.6, r * 0.75, r * 1.2, r * 0.2, o);
      shape(g, "#b08040", o * 0.6, () => g.arc(-r * 0.45, r * 0.55, r * 0.26, 0, Math.PI * 2));
      g.strokeStyle = "#5a3a10";
      lw(g, r * 0.05);
      g.beginPath();
      g.arc(-r * 0.45, r * 0.55, r * 0.15, 0, Math.PI * 2);
      g.stroke();
      shape(g, METAL.light, o * 0.4, () => roundRect(g, -r * 0.3, -r * 0.62, r * 0.45, r * 0.2, r * 0.05));
      return true;
    }
    case "aamissile": {
      g.strokeStyle = METAL.dark;
      lw(g, r * 0.12);
      g.beginPath();
      g.moveTo(-r * 0.3, -r * 0.55);
      g.lineTo(-r * 0.3, r * 0.55);
      g.stroke();
      for (const y of [-0.55, 0.55]) lyingMissile(g, -r * 0.8, y * r, r * 2.1, r * 0.2, "#3a8ad8", o);
      housing(g, pal, -r * 0.7, -r * 0.3, r * 0.75, r * 0.6, r * 0.15, o);
      glowDot(g, -r * 0.3, 0, r * 0.06, "#3a8ad8");
      return true;
    }
    case "sam": {
      cellGrid(g, pal, 2, 2, r * 0.78, o, "#d8d4c8");
      g.fillStyle = "#c0392b";
      for (const [x, y] of [[0, -0.39], [0.78, -0.39], [0, 0.39], [0.78, 0.39]]) {
        g.beginPath();
        g.arc(x * r - r * 0.39 + r * 0.55, y * r, r * 0.1, 0, Math.PI * 2);
        g.fill();
      }
      return true;
    }
    case "swarm": {
      cellGrid(g, pal, 4, 2, r * 0.5, o, "#e0b040");
      return true;
    }
    case "incendiary": {
      drawFamily(g, m, pal, r, m.caliber ?? 0.5, m.barrels ?? 4, o, glow);
      const cell = r * 0.62, x0 = -cell + r * 0.25;
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
        shape(g, "#ff8a1a", 0, () => g.arc(x0 + (j + 0.5) * cell + cell * 0.08, -cell + (i + 0.5) * cell, cell * 0.17, 0, Math.PI * 2));
      }
      shape(g, "#ff5a10", 0, () => g.rect(x0 - cell * 0.15, -cell - cell * 0.15, cell * 2.3, cell * 0.12));
      return true;
    }
    case "howitzer": {
      for (const s of [-1, 1]) {
        g.strokeStyle = OUTLINE;
        lw(g, r * 0.22);
        g.beginPath();
        g.moveTo(-r * 0.4, s * r * 0.4);
        g.lineTo(-r * 1.55, s * r * 0.85);
        g.stroke();
        g.strokeStyle = METAL.dark;
        lw(g, r * 0.14);
        g.stroke();
        shape(g, METAL.base, o * 0.6, () => roundRect(g, -r * 1.75, s * r * 0.85 - r * 0.18, r * 0.25, r * 0.36, r * 0.05));
      }
      drawFamily(g, m, pal, r, m.caliber ?? 0.9, 1, o, glow);
      return true;
    }
    case "barrage": {
      for (const y of [-0.5, 0, 0.5]) {
        barrel(g, 0, r * 1.9, y * r, r * 0.3, o);
        shape(g, METAL.dark, o * 0.6, () => roundRect(g, r * 1.8, y * r - r * 0.2, r * 0.25, r * 0.4, r * 0.06));
      }
      housing(g, pal, -r * 1.05, -r * 0.95, r * 1.55, r * 1.9, r * 0.2, o);
      for (const y of [-0.5, 0, 0.5]) shape(g, METAL.dark, o * 0.5, () => roundRect(g, -r * 0.8, y * r - r * 0.12, r * 0.9, r * 0.24, r * 0.06));
      return true;
    }
    case "plasmaorb": {
      barrel(g, 0, r * 1.5, 0, r * 0.36, o, METAL.dark);
      shape(g, METAL.dark, o * 0.6, () => roundRect(g, r * 1.35, -r * 0.3, r * 0.25, r * 0.6, r * 0.1));
      housing(g, pal, -r * 0.95, -r * 0.8, r * 1.4, r * 1.6, r * 0.45, o);
      shape(g, "#1a0a24", o, () => g.arc(-r * 0.2, 0, r * 0.58, 0, Math.PI * 2));
      glowDot(g, -r * 0.2, 0, r * 0.25, "#e070ff");
      g.strokeStyle = "#b060e0";
      lw(g, r * 0.05);
      g.beginPath();
      g.arc(-r * 0.2, 0, r * 0.45, 0.4, 2.6);
      g.arc(-r * 0.2, 0, r * 0.45, 3.5, 5.8);
      g.stroke();
      return true;
    }
    case "napalm": {
      const len = r * 1.7;
      shape(g, METAL.base, o, () => {
        g.moveTo(r * 0.1, -r * 0.22);
        g.lineTo(len, -r * 0.4);
        g.lineTo(len, r * 0.4);
        g.lineTo(r * 0.1, r * 0.22);
        g.closePath();
      });
      shape(g, METAL.dark, o * 0.6, () => roundRect(g, len - r * 0.25, -r * 0.42, r * 0.3, r * 0.84, r * 0.08));
      glowDot(g, len + r * 0.08, 0, r * 0.07, "#ff9030");
      housing(g, pal, -r * 0.45, -r * 0.55, r * 0.85, r * 1.1, r * 0.25, o);
      for (const y of [-0.5, 0.5]) {
        shape(g, "#3f8a2a", o, () => roundRect(g, -r * 1.2, y * r - r * 0.3, r * 0.95, r * 0.6, r * 0.3));
        g.fillStyle = "rgba(190,255,120,0.55)";
        g.fillRect(-r * 1.05, y * r - r * 0.18, r * 0.6, r * 0.1);
      }
      return true;
    }
    case "arclance": {
      shape(g, teamGrad(g, pal, r), o, () => {
        for (let i = 0; i < 8; i++) {
          const a = i / 8 * Math.PI * 2;
          const f = i === 0 ? g.moveTo.bind(g) : g.lineTo.bind(g);
          f(Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95);
        }
        g.closePath();
      });
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * Math.PI * 2;
        g.strokeStyle = OUTLINE;
        lw(g, r * 0.16);
        g.beginPath();
        g.moveTo(Math.cos(a) * r * 0.3, Math.sin(a) * r * 0.3);
        g.lineTo(Math.cos(a) * r * 1.15, Math.sin(a) * r * 1.15);
        g.stroke();
        g.strokeStyle = "#c88a3c";
        lw(g, r * 0.09);
        g.stroke();
        glowDot(g, Math.cos(a) * r * 1.15, Math.sin(a) * r * 1.15, r * 0.06, "#a8d8ff");
      }
      for (const rr2 of [0.55, 0.4]) {
        g.strokeStyle = "#c88a3c";
        lw(g, r * 0.1);
        g.beginPath();
        g.arc(0, 0, r * rr2, 0, Math.PI * 2);
        g.stroke();
      }
      shape(g, "#e8f6ff", o * 0.6, () => g.arc(0, 0, r * 0.25, 0, Math.PI * 2));
      glowDot(g, 0, 0, r * 0.2, "#a8d8ff");
      return true;
    }
    case "stungun": {
      for (const s of [-1, 1]) {
        barrel(g, r * 0.1, r * 1.5, s * r * 0.22, r * 0.1, o, METAL.light);
        glowDot(g, r * 1.5, s * r * 0.22, r * 0.07, "#bfe4ff");
      }
      housing(g, pal, -r * 0.75, -r * 0.5, r * 1, r * 1, r * 0.4, o);
      shape(g, "#f0d020", o * 0.4, () => {
        g.moveTo(-r * 0.1, -r * 0.35);
        g.lineTo(-r * 0.35, r * 0.05);
        g.lineTo(-r * 0.2, r * 0.05);
        g.lineTo(-r * 0.35, r * 0.35);
        g.lineTo(-r * 0, -r * 0.05);
        g.lineTo(-r * 0.15, -r * 0.05);
        g.closePath();
      });
      return true;
    }
    case "empcannon": {
      barrel(g, 0, r * 1.6, 0, r * 0.3, o, METAL.dark);
      for (let i = 0; i < 3; i++) shape(g, "#3a6ab0", o * 0.5, () => roundRect(g, r * (0.5 + i * 0.35), -r * 0.24, r * 0.12, r * 0.48, r * 0.04));
      glowDot(g, r * 1.62, 0, r * 0.1, "#a8d8ff");
      housing(g, pal, -r * 0.9, -r * 0.8, r * 1.3, r * 1.6, r * 0.4, o);
      shape(g, "#0a1830", o, () => g.arc(-r * 0.25, 0, r * 0.55, 0, Math.PI * 2));
      glowDot(g, -r * 0.25, 0, r * 0.28, "#5aa0ff");
      return true;
    }
    case "disarm": {
      shape(g, METAL.dark, o, () => roundRect(g, r * 0, -r * 0.18, r * 1.1, r * 0.36, r * 0.08));
      shape(g, metalGrad(g, r, METAL.light), o, () => {
        g.moveTo(r * 0.9, -r * 0.7);
        g.lineTo(r * 1.25, -r * 0.55);
        g.lineTo(r * 1.25, r * 0.55);
        g.lineTo(r * 0.9, r * 0.7);
        g.closePath();
      });
      glowDot(g, r * 1.25, 0, r * 0.14, "#ffe84a");
      housing(g, pal, -r * 0.85, -r * 0.65, r * 1.05, r * 1.3, r * 0.3, o);
      shape(g, "#ffe84a", o * 0.4, () => g.arc(-r * 0.3, 0, r * 0.2, 0, Math.PI * 2));
      g.strokeStyle = "#151515";
      lw(g, r * 0.05);
      g.beginPath();
      g.moveTo(-r * 0.45, -r * 0.15);
      g.lineTo(-r * 0.15, r * 0.15);
      g.moveTo(-r * 0.15, -r * 0.15);
      g.lineTo(-r * 0.45, r * 0.15);
      g.stroke();
      return true;
    }
    case "railgun": {
      drawFamily(g, m, pal, r, 0.9, 1, o, glow);
      for (const x of [0.75, 1.3, 1.85]) shape(g, rgba("#9fe8ff", 0.85), 0, () => roundRect(g, x * r, -r * 0.42, r * 0.08, r * 0.84, r * 0.03));
      shape(g, METAL.dark, o * 0.6, () => roundRect(g, -r * 1.25, -r * 0.45, r * 0.3, r * 0.9, r * 0.08));
      return true;
    }
    case "shieldH": {
      drawFamily(g, m, pal, r, 0.9, 1, o, glow);
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * Math.PI * 2 + 0.52;
        shape(g, "#7fd8ff", o * 0.4, () => g.arc(Math.cos(a) * r * 1.05, Math.sin(a) * r * 1.05, r * 0.11, 0, Math.PI * 2));
      }
      g.strokeStyle = rgba("#7fd8ff", 0.6);
      lw(g, r * 0.05);
      g.beginPath();
      g.arc(0, 0, r * 1.05, 0, Math.PI * 2);
      g.stroke();
      return true;
    }
    case "shieldL": {
      shape(g, METAL.dark, o, () => roundRect(g, -r * 0.7, -r * 0.7, r * 1.4, r * 1.4, r * 0.3));
      const gr = g.createRadialGradient(-r * 0.2, -r * 0.2, 0, 0, 0, r * 0.55);
      gr.addColorStop(0, "#ffffff");
      gr.addColorStop(0.5, "#7fd8ff");
      gr.addColorStop(1, "#1a4a6a");
      shape(g, gr, o * 0.5, () => g.arc(0, 0, r * 0.5, 0, Math.PI * 2));
      return true;
    }
    case "hardened": {
      housing(g, pal, -r * 0.8, -r * 0.7, r * 1.6, r * 1.4, r * 0.15, o);
      shape(g, METAL.dark, o * 0.6, () => roundRect(g, -r * 0.6, -r * 0.5, r * 1.2, r * 1, r * 0.1));
      g.strokeStyle = "#d0d4d8";
      lw(g, r * 0.08);
      g.beginPath();
      g.moveTo(-r * 0.4, -r * 0.3);
      g.lineTo(r * 0.4, -r * 0.3);
      g.lineTo(-r * 0.4, r * 0.3);
      g.lineTo(r * 0.4, r * 0.3);
      g.stroke();
      rivets(g, [-r * 0.7, -r * 0.6, r * 0.7, -r * 0.6, -r * 0.7, r * 0.6, r * 0.7, r * 0.6], r * 0.07);
      return true;
    }
    case "autoloader": {
      housing(g, pal, -r * 0.8, -r * 0.6, r * 1.5, r * 1.2, r * 0.2, o);
      for (let i = 0; i < 5; i++) {
        shape(g, "#c9a040", o * 0.4, () => roundRect(g, -r * 0.65 + i * r * 0.27, -r * 0.35, r * 0.2, r * 0.7, r * 0.08));
        g.fillStyle = "#8a5a20";
        g.fillRect(-r * 0.65 + i * r * 0.27, r * 0.2, r * 0.2, r * 0.12);
      }
      return true;
    }
    case "overclock": {
      housing(g, pal, -r * 0.85, -r * 0.75, r * 1.7, r * 1.5, r * 0.3, o);
      g.strokeStyle = "#3a8ab0";
      lw(g, r * 0.12);
      g.beginPath();
      g.moveTo(-r * 0.7, -r * 0.5);
      g.bezierCurveTo(-r * 0.2, -r * 0.9, r * 0.4, -r * 0.2, r * 0.7, -r * 0.5);
      g.moveTo(-r * 0.7, r * 0.5);
      g.bezierCurveTo(-r * 0.2, r * 0.9, r * 0.4, r * 0.2, r * 0.7, r * 0.5);
      g.stroke();
      shape(g, "#2a0a0a", o * 0.6, () => roundRect(g, -r * 0.35, -r * 0.35, r * 0.7, r * 0.7, r * 0.1));
      glowDot(g, 0, 0, r * 0.2, "#ff4a2a");
      return true;
    }
    case "targeting": {
      housing(g, pal, -r * 0.7, -r * 0.5, r * 1.1, r * 1, r * 0.25, o);
      shape(g, METAL.dark, o * 0.6, () => roundRect(g, r * 0.1, -r * 0.2, r * 0.7, r * 0.4, r * 0.1));
      shape(g, "#ff3a3a", o * 0.4, () => g.arc(r * 0.8, 0, r * 0.14, 0, Math.PI * 2));
      g.strokeStyle = "#ff3a3a";
      lw(g, r * 0.05);
      g.beginPath();
      g.arc(-r * 0.2, 0, r * 0.28, 0, Math.PI * 2);
      g.moveTo(-r * 0.55, 0);
      g.lineTo(r * 0.15, 0);
      g.moveTo(-r * 0.2, -r * 0.35);
      g.lineTo(-r * 0.2, r * 0.35);
      g.stroke();
      return true;
    }
    case "phantom": {
      shape(g, teamGrad(g, pal, r), o, () => g.arc(0, 0, r * 0.9, 0, Math.PI * 2));
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, r * 0.75);
      gr.addColorStop(0, "#f8e8ff");
      gr.addColorStop(0.5, "#8a5ac8");
      gr.addColorStop(1, "#1a0a2a");
      shape(g, gr, o * 0.5, () => g.arc(0, 0, r * 0.7, 0, Math.PI * 2));
      for (let i = 0; i < 4; i++) {
        const a = i / 4 * Math.PI * 2 + 0.78;
        shape(g, "#c8a8ff", o * 0.4, () => g.arc(Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9, r * 0.1, 0, Math.PI * 2));
      }
      g.strokeStyle = "rgba(230,210,255,0.6)";
      lw(g, r * 0.05);
      for (let i = 0; i < 3; i++) {
        g.beginPath();
        g.arc(0, 0, r * (0.2 + i * 0.16), -i, 2.5 - i);
        g.stroke();
      }
      return true;
    }
    case "selfdestruct": {
      shape(g, "#2a2a2a", o, () => roundRect(g, -r * 0.8, -r * 0.65, r * 1.6, r * 1.3, r * 0.12));
      hazard(g, -r * 0.72, -r * 0.57, r * 1.44, r * 0.28);
      hazard(g, -r * 0.72, r * 0.29, r * 1.44, r * 0.28);
      shape(g, "#a02020", o * 0.5, () => g.arc(0, 0, r * 0.22, 0, Math.PI * 2));
      glowDot(g, 0, 0, r * 0.1, "#ff3030");
      return true;
    }
    case "gyro":
      return false;
  }
  return false;
}
function spreadOffsets(n, span) {
  if (n <= 1) return [0];
  const out2 = [];
  for (let i = 0; i < n; i++) out2.push(-span / 2 + span * i / (n - 1));
  return out2;
}
function drawTurret(g, m, pal, d, o) {
  const r = d / 2;
  const c = m.caliber ?? 0.5;
  const n = m.barrels ?? 1;
  const glow = moduleGlow(m, pal);
  g.lineJoin = "round";
  g.lineCap = "round";
  if (drawSpecial(g, m, pal, r, o, glow)) {
    categoryTick(g, m, r, o);
    return;
  }
  drawFamily(g, m, pal, r, c, n, o, glow);
  categoryTick(g, m, r, o);
}
var CATEGORY_COLOR = {
  machinegun: "#ffd54a",
  autocannon: "#ffa23a",
  cannon: "#ff6a3a",
  precision: "#5ad8ff",
  rocket: "#ff4a4a",
  missile: "#ff7ab0",
  artillery: "#c8a060",
  energy: "#d070ff",
  flame: "#ff8a20",
  disruption: "#80a8ff",
  antiair: "#a0ff70",
  melee: "#ff3060",
  support: "#5aff9a",
  defense: "#7fd8ff",
  stealth: "#a0a0c8",
  systems: "#e0e0a0",
  armor: "#b0b8c0"
};
function categoryTick(g, m, r, o) {
  const col = CATEGORY_COLOR[m.category];
  if (!col) return;
  shape(g, col, o * 0.5, () => roundRect(g, -r * 1.02, -r * 0.16, r * 0.16, r * 0.32, r * 0.05));
}
function drawFamily(g, m, pal, r, c, n, o, glow) {
  switch (m.visual) {
    case "gun": {
      const bw = r * (0.2 + 0.28 * c) * (n >= 4 ? 0.75 : 1);
      const len = r * (1.7 + c * 0.9);
      const offs = n >= 4 ? [-0.42, -0.14, 0.14, 0.42].map((v) => v * r * 1.6) : spreadOffsets(n, r * 0.75);
      for (const y of offs) {
        barrel(g, 0, len, y, bw, o);
        if (c >= 0.45) muzzle(g, len, y, bw * 1.45, bw * 1.4, o * 0.7);
      }
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 0.95, -r * (n >= 2 ? 0.95 : 0.8), r * 1.75, r * (n >= 2 ? 1.9 : 1.6), r * 0.35));
      shape(g, METAL.dark, o * 0.6, () => roundRect(g, r * 0.55, -r * (n >= 2 ? 0.7 : 0.45), r * 0.4, r * (n >= 2 ? 1.4 : 0.9), r * 0.12));
      if (n >= 4) {
        shape(g, METAL.light, o * 0.6, () => g.ellipse(-r * 0.45, 0, r * 0.22, r * 0.45, 0, 0, Math.PI * 2));
      } else hatch(g, -r * 0.35, -r * 0.25, r * 0.28, o);
      shape(g, shade(pal.dark, -0.2), o * 0.6, () => roundRect(g, -r * 0.8, r * 0.25, r * 0.6, r * 0.45, r * 0.08));
      break;
    }
    case "gatling": {
      const len = r * 2;
      shape(g, metalGrad(g, r * 0.5, METAL.dark), o, () => roundRect(g, r * 0.2, -r * 0.42, len - r * 0.2, r * 0.84, r * 0.2));
      g.strokeStyle = METAL.light;
      lw(g, r * 0.07);
      for (const y of [-0.27, -0.09, 0.09, 0.27]) {
        g.beginPath();
        g.moveTo(r * 0.5, y * r);
        g.lineTo(len - r * 0.05, y * r);
        g.stroke();
      }
      for (const x of [0.75, 1.45]) shape(g, METAL.base, o * 0.6, () => roundRect(g, x * r, -r * 0.5, r * 0.18, r, r * 0.05));
      shape(g, METAL.deep, 0, () => g.arc(len, 0, r * 0.18, 0, Math.PI * 2));
      shape(g, teamGrad(g, pal, r), o, () => g.arc(-r * 0.1, 0, r * 0.82, 0, Math.PI * 2));
      shape(g, METAL.base, o * 0.6, () => roundRect(g, -r * 0.4, -r * 0.95, r * 0.7, r * 0.35, r * 0.08));
      hatch(g, -r * 0.25, r * 0.15, r * 0.25, o);
      break;
    }
    case "shotgun": {
      const len = r * 1.75;
      shape(g, METAL.base, o, () => {
        g.moveTo(r * 0.2, -r * 0.24);
        g.lineTo(len, -r * 0.38);
        g.lineTo(len, r * 0.38);
        g.lineTo(r * 0.2, r * 0.24);
        g.closePath();
      });
      shape(g, METAL.deep, 0, () => g.ellipse(len - r * 0.05, 0, r * 0.08, r * 0.3, 0, 0, Math.PI * 2));
      shape(g, METAL.dark, o * 0.6, () => roundRect(g, r * 0.65, -r * 0.3, r * 0.45, r * 0.6, r * 0.1));
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 0.9, -r * 0.75, r * 1.4, r * 1.5, r * 0.3));
      rivets(g, [-r * 0.6, -r * 0.45, -r * 0.6, r * 0.45, r * 0.2, -r * 0.45, r * 0.2, r * 0.45], r * 0.07);
      break;
    }
    case "cannon": {
      const bw = r * (0.24 + 0.12 * c);
      const len = r * 2.45;
      for (const y of spreadOffsets(n, r * 0.7)) {
        barrel(g, 0, len, y, bw, o);
        shape(g, METAL.base, o * 0.7, () => roundRect(g, len * 0.48, y - bw * 0.72, len * 0.16, bw * 1.44, bw * 0.4));
        muzzle(g, len + bw * 0.25, y, bw * 1.5, bw * 1.1, o * 0.7);
      }
      shape(g, teamGrad(g, pal, r), o, () => {
        g.moveTo(r * 0.85, -r * 0.55);
        g.lineTo(r * 0.6, -r * 0.92);
        g.lineTo(-r * 0.75, -r * 0.92);
        g.lineTo(-r * 1, -r * 0.5);
        g.lineTo(-r * 1, r * 0.5);
        g.lineTo(-r * 0.75, r * 0.92);
        g.lineTo(r * 0.6, r * 0.92);
        g.lineTo(r * 0.85, r * 0.55);
        g.closePath();
      });
      g.strokeStyle = rgba(pal.deep, 0.5);
      lw(g, o * 0.5);
      g.beginPath();
      g.moveTo(-r * 0.2, -r * 0.88);
      g.lineTo(-r * 0.2, r * 0.88);
      g.stroke();
      shape(g, METAL.dark, o * 0.6, () => roundRect(g, r * 0.55, -r * 0.42 * (n > 1 ? 1.5 : 1), r * 0.35, r * 0.84 * (n > 1 ? 1.5 : 1), r * 0.1));
      hatch(g, -r * 0.55, -r * 0.4, r * 0.24, o);
      hatch(g, -r * 0.55, r * 0.4, r * 0.18, o);
      shape(g, pal.accent, 0, () => roundRect(g, -r * 0.95, -r * 0.12, r * 0.18, r * 0.24, r * 0.05));
      break;
    }
    case "gauss": {
      const len = r * 2.55;
      shape(g, METAL.dark, o, () => roundRect(g, 0, -r * 0.3, len, r * 0.6, r * 0.12));
      g.strokeStyle = glow;
      lw(g, r * 0.08);
      g.beginPath();
      g.moveTo(r * 0.2, 0);
      g.lineTo(len - r * 0.05, 0);
      g.stroke();
      for (let i = 0; i < 6; i++) {
        const x = r * (0.45 + i * 0.33);
        shape(g, "#c27a3a", o * 0.5, () => roundRect(g, x, -r * 0.38, r * 0.16, r * 0.76, r * 0.05));
      }
      glowDot(g, len, 0, r * 0.12, glow);
      shape(g, teamGrad(g, pal, r), o, () => {
        g.moveTo(r * 0.7, -r * 0.6);
        g.lineTo(-r * 0.4, -r * 0.95);
        g.lineTo(-r * 1, -r * 0.6);
        g.lineTo(-r * 1, r * 0.6);
        g.lineTo(-r * 0.4, r * 0.95);
        g.lineTo(r * 0.7, r * 0.6);
        g.closePath();
      });
      shape(g, METAL.dark, o * 0.6, () => roundRect(g, -r * 0.75, -r * 0.35, r * 0.7, r * 0.7, r * 0.1));
      glowDot(g, -r * 0.4, 0, r * 0.12, glow);
      break;
    }
    case "sniper": {
      const len = r * 2.9;
      barrel(g, 0, len, 0, r * 0.16, o);
      muzzle(g, len, 0, r * 0.28, r * 0.3, o * 0.7);
      shape(g, METAL.deep, o * 0.6, () => roundRect(g, r * 0.1, -r * 0.42, r * 0.9, r * 0.2, r * 0.08));
      shape(g, "#7fd0ff", 0, () => g.arc(r * 1, -r * 0.32, r * 0.07, 0, Math.PI * 2));
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 0.85, -r * 0.55, r * 1.25, r * 1.1, r * 0.3));
      shape(g, METAL.dark, o * 0.5, () => roundRect(g, -r * 0.6, r * 0.15, r * 0.5, r * 0.25, r * 0.06));
      break;
    }
    case "rail": {
      const len = r * (2.3 + c * 0.5);
      shape(g, METAL.deep, 0, () => g.rect(r * 0.3, -r * 0.14, len - r * 0.3, r * 0.28));
      g.strokeStyle = glow;
      lw(g, r * 0.1);
      g.beginPath();
      g.moveTo(r * 0.3, 0);
      g.lineTo(len, 0);
      g.stroke();
      for (const y of [-0.24, 0.24]) barrel(g, 0, len, y * r, r * 0.2, o, METAL.light);
      for (let i = 0; i < 3; i++) shape(g, METAL.dark, o * 0.5, () => roundRect(g, r * (0.6 + i * 0.55), -r * 0.4, r * 0.12, r * 0.8, r * 0.04));
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 1, -r * 0.8, r * 1.5, r * 1.6, r * 0.18));
      for (const y of [-0.5, 0.5]) shape(g, METAL.dark, o * 0.5, () => roundRect(g, -r * 0.85, y * r - r * 0.18, r * 1, r * 0.36, r * 0.06));
      glowDot(g, -r * 0.35, -r * 0.5, r * 0.08, glow);
      glowDot(g, -r * 0.35, r * 0.5, r * 0.08, glow);
      break;
    }
    case "rocketPod": {
      const cols = n >= 12 ? 4 : n >= 4 ? 2 : 1;
      const rows = Math.ceil(n / cols);
      const cell = r * (n >= 12 ? 0.48 : 0.62);
      const w = cols * cell, h = rows * cell;
      const x0 = -w / 2 + r * 0.25;
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, x0 - cell * 0.15, -h / 2 - cell * 0.15, w + cell * 0.3, h + cell * 0.3, cell * 0.2));
      for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
        const cx = x0 + (j + 0.5) * cell, cy = -h / 2 + (i + 0.5) * cell;
        shape(g, METAL.deep, o * 0.4, () => g.arc(cx, cy, cell * 0.38, 0, Math.PI * 2));
        shape(g, j === cols - 1 ? "#d8d2c0" : "#9a9384", 0, () => g.arc(cx + cell * 0.06, cy, cell * 0.2, 0, Math.PI * 2));
        g.fillStyle = "#c0392b";
        g.beginPath();
        g.arc(cx + cell * 0.1, cy, cell * 0.1, 0, Math.PI * 2);
        g.fill();
      }
      shape(g, pal.accent, 0, () => g.rect(x0 - cell * 0.15, -h / 2 - cell * 0.15, cell * 0.12, h + cell * 0.3));
      break;
    }
    case "missileRack": {
      const rows = n >= 8 ? 4 : n >= 4 ? 2 : n;
      const per = n >= 8 ? 2 : n >= 4 ? 2 : 1;
      const ml = r * (n >= 8 ? 1 : 1.55);
      const mw = r * (n >= 8 ? 0.2 : 0.26);
      const span = rows * mw * 1.5;
      shape(g, METAL.dark, o, () => roundRect(g, -r * 0.85, -span / 2 - mw * 0.4, r * 1.6 + (per > 1 ? 0 : r * 0.2), span + mw * 0.8, mw * 0.4));
      for (let i = 0; i < rows; i++) {
        const y = -span / 2 + (i + 0.5) * mw * 1.5;
        for (let k = 0; k < per; k++) {
          const xs = per > 1 ? -r * 0.8 + k * ml * 1.02 : -r * 0.75;
          const len = per > 1 ? ml * 0.95 : ml;
          shape(g, "#e4e2da", o * 0.5, () => roundRect(g, xs, y - mw / 2, len, mw, mw / 2));
          g.fillStyle = k === per - 1 ? pal.accent : "#c0392b";
          g.beginPath();
          g.moveTo(xs + len, y);
          g.lineTo(xs + len - mw * 1.1, y - mw / 2);
          g.lineTo(xs + len - mw * 1.1, y + mw / 2);
          g.closePath();
          g.fill();
          g.fillStyle = "#8b8b84";
          g.fillRect(xs, y - mw * 0.75, mw * 0.6, mw * 1.5);
        }
      }
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 1, -r * 0.35, r * 0.4, r * 0.7, r * 0.1));
      break;
    }
    case "cruise": {
      const len = r * 3;
      shape(g, METAL.dark, o, () => roundRect(g, -r * 1.2, -r * 0.55, r * 2.3, r * 1.1, r * 0.15));
      shape(g, "#dedbd0", o, () => roundRect(g, -r * 1.35, -r * 0.3, len, r * 0.6, r * 0.3));
      g.fillStyle = pal.accent;
      g.fillRect(-r * 0.2, -r * 0.3, r * 0.15, r * 0.6);
      g.fillStyle = "#b8352a";
      g.beginPath();
      g.moveTo(len - r * 1.35, 0);
      g.lineTo(len - r * 1.9, -r * 0.3);
      g.lineTo(len - r * 1.9, r * 0.3);
      g.closePath();
      g.fill();
      shape(g, "#a9a69c", o * 0.6, () => {
        g.moveTo(-r * 0.9, -r * 0.3);
        g.lineTo(-r * 1.35, -r * 0.75);
        g.lineTo(-r * 1.45, -r * 0.75);
        g.lineTo(-r * 1.3, -r * 0.3);
        g.closePath();
      });
      shape(g, "#a9a69c", o * 0.6, () => {
        g.moveTo(-r * 0.9, r * 0.3);
        g.lineTo(-r * 1.35, r * 0.75);
        g.lineTo(-r * 1.45, r * 0.75);
        g.lineTo(-r * 1.3, r * 0.3);
        g.closePath();
      });
      shape(g, "#a9a69c", o * 0.6, () => {
        g.moveTo(r * 0.5, -r * 0.3);
        g.lineTo(r * 0.25, -r * 0.55);
        g.lineTo(r * 0.1, -r * 0.55);
        g.lineTo(r * 0.15, -r * 0.3);
        g.closePath();
      });
      shape(g, "#a9a69c", o * 0.6, () => {
        g.moveTo(r * 0.5, r * 0.3);
        g.lineTo(r * 0.25, r * 0.55);
        g.lineTo(r * 0.1, r * 0.55);
        g.lineTo(r * 0.15, r * 0.3);
        g.closePath();
      });
      break;
    }
    case "mortar": {
      shape(g, METAL.dark, o, () => {
        for (let i = 0; i < 3; i++) {
          const a = Math.PI * 0.66 * i + Math.PI;
          g.moveTo(0, 0);
          g.lineTo(Math.cos(a) * r * 1, Math.sin(a) * r * 1);
        }
      });
      g.strokeStyle = METAL.dark;
      lw(g, r * 0.14);
      g.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = Math.PI * 0.66 * i + Math.PI;
        g.moveTo(0, 0);
        g.lineTo(Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95);
      }
      g.stroke();
      shape(g, teamGrad(g, pal, r), o, () => g.arc(-r * 0.1, 0, r * 0.75, 0, Math.PI * 2));
      shape(g, metalGrad(g, r * 0.5), o, () => g.ellipse(r * 0.35, 0, r * 0.6, r * 0.52, 0, 0, Math.PI * 2));
      shape(g, METAL.deep, 0, () => g.ellipse(r * 0.45, 0, r * 0.36, r * 0.32, 0, 0, Math.PI * 2));
      g.strokeStyle = "rgba(255,255,255,0.25)";
      lw(g, r * 0.05);
      g.beginPath();
      g.ellipse(r * 0.35, 0, r * 0.5, r * 0.43, 0, Math.PI * 1.1, Math.PI * 1.6);
      g.stroke();
      break;
    }
    case "artillery": {
      const multi = n > 1;
      const len = r * (multi ? 2.25 : 2.9);
      const bw = r * (multi ? 0.2 : 0.3);
      for (const y of spreadOffsets(n, r * 0.9)) {
        barrel(g, 0, len, y, bw, o);
        muzzle(g, len + bw * 0.3, y, bw * 1.6, bw * 1.3, o * 0.7);
        if (!multi) for (const s of [-1, 1]) shape(g, METAL.light, o * 0.5, () => roundRect(g, r * 0.4, y + s * bw * 0.85 - bw * 0.2, r * 0.8, bw * 0.4, bw * 0.2));
      }
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 1.1, -r * 0.9, r * 1.8, r * 1.8, r * 0.25));
      shape(g, METAL.dark, o * 0.7, () => roundRect(g, r * 0.25, -r * 0.65, r * 0.6, r * 1.3, r * 0.15));
      g.strokeStyle = rgba(pal.deep, 0.5);
      lw(g, o * 0.5);
      for (const x of [-0.6, -0.15]) {
        g.beginPath();
        g.moveTo(x * r, -r * 0.85);
        g.lineTo(x * r, r * 0.85);
        g.stroke();
      }
      rivets(g, [-r * 0.9, -r * 0.7, -r * 0.9, r * 0.7, r * 0.5, -r * 0.75, r * 0.5, r * 0.75], r * 0.06);
      break;
    }
    case "laser": {
      const len = r * 1.85;
      for (const y of spreadOffsets(n, r * 0.8)) {
        shape(g, METAL.dark, o, () => roundRect(g, 0, y - r * 0.16, len, r * 0.32, r * 0.14));
        g.strokeStyle = METAL.light;
        lw(g, r * 0.05);
        for (let i = 0; i < 4; i++) {
          const x = r * (0.6 + i * 0.25);
          g.beginPath();
          g.moveTo(x, y - r * 0.15);
          g.lineTo(x, y + r * 0.15);
          g.stroke();
        }
        glowDot(g, len, y, r * 0.11, glow);
      }
      shape(g, teamGrad(g, pal, r), o, () => g.arc(0, 0, r * 0.82, 0, Math.PI * 2));
      shape(g, rgba(glow, 0.9), o * 0.5, () => g.ellipse(-r * 0.15, 0, r * 0.32, r * 0.22, 0, 0, Math.PI * 2));
      g.fillStyle = "rgba(255,255,255,0.7)";
      g.beginPath();
      g.arc(-r * 0.25, -r * 0.08, r * 0.08, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case "heatray": {
      shape(g, METAL.dark, o, () => roundRect(g, 0, -r * 0.15, r * 0.7, r * 0.3, r * 0.1));
      shape(g, metalGrad(g, r, METAL.light), o, () => {
        g.moveTo(r * 0.45, -r * 0.95);
        g.quadraticCurveTo(r * 0, 0, r * 0.45, r * 0.95);
        g.lineTo(r * 0.62, r * 0.88);
        g.quadraticCurveTo(r * 0.25, 0, r * 0.62, -r * 0.88);
        g.closePath();
      });
      g.strokeStyle = METAL.dark;
      lw(g, r * 0.06);
      g.beginPath();
      g.moveTo(r * 0.5, -r * 0.8);
      g.lineTo(r * 1.05, 0);
      g.lineTo(r * 0.5, r * 0.8);
      g.stroke();
      glowDot(g, r * 1.05, 0, r * 0.14, glow);
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 0.95, -r * 0.6, r * 0.95, r * 1.2, r * 0.3));
      g.fillStyle = rgba("#ff7a2a", 0.8);
      for (const y of [-0.3, 0, 0.3]) g.fillRect(-r * 0.75, y * r - r * 0.05, r * 0.5, r * 0.1);
      break;
    }
    case "plasma": {
      const big = c > 0.7;
      const len = r * (big ? 2.2 : 1.8);
      const bw = r * (big ? 0.42 : 0.5);
      shape(g, METAL.dark, o, () => roundRect(g, 0, -bw / 2, len, bw, bw * 0.4));
      for (let i = 0; i < (big ? 4 : 2); i++) {
        const x = r * (0.5 + i * 0.4);
        shape(g, "#8a3fb0", o * 0.5, () => roundRect(g, x, -bw * 0.68, r * 0.16, bw * 1.36, r * 0.06));
        g.fillStyle = rgba(glow, 0.9);
        g.fillRect(x + r * 0.04, -bw * 0.5, r * 0.08, bw);
      }
      glowDot(g, len, 0, r * (big ? 0.16 : 0.22), glow);
      shape(g, teamGrad(g, pal, r), o, () => g.ellipse(-r * 0.15, 0, r * 0.95, r * 0.85, 0, 0, Math.PI * 2));
      shape(g, METAL.dark, o * 0.6, () => g.arc(-r * 0.35, 0, r * 0.38, 0, Math.PI * 2));
      glowDot(g, -r * 0.35, 0, r * 0.16, glow);
      break;
    }
    case "flamer": {
      const twin = c > 0.5;
      const len = r * 1.6;
      shape(g, METAL.base, o, () => {
        g.moveTo(r * 0.1, -r * 0.18);
        g.lineTo(len, -r * 0.26);
        g.lineTo(len, r * 0.26);
        g.lineTo(r * 0.1, r * 0.18);
        g.closePath();
      });
      shape(g, METAL.dark, o * 0.6, () => roundRect(g, len - r * 0.25, -r * 0.3, r * 0.3, r * 0.6, r * 0.08));
      glowDot(g, len + r * 0.08, r * 0.18, r * 0.06, "#ff9030");
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 0.5, -r * 0.6, r * 0.95, r * 1.2, r * 0.25));
      const tanks = twin ? [-0.42, 0.42] : [0];
      for (const y of tanks) {
        shape(g, "#b8552a", o, () => roundRect(g, -r * 1.15, y * r - r * 0.3, r * 0.85, r * 0.6, r * 0.3));
        g.fillStyle = "rgba(255,255,255,0.3)";
        g.fillRect(-r * 1, y * r - r * 0.18, r * 0.55, r * 0.08);
        g.fillStyle = "#1a1a1a";
        for (const x of [-0.95, -0.62]) g.fillRect(x * r, y * r - r * 0.3, r * 0.06, r * 0.6);
      }
      break;
    }
    case "tesla": {
      const big = c > 0.7;
      shape(g, teamGrad(g, pal, r), o, () => {
        for (let i = 0; i < 6; i++) {
          const a = i / 6 * Math.PI * 2 + Math.PI / 6;
          const f = i === 0 ? g.moveTo.bind(g) : g.lineTo.bind(g);
          f(Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95);
        }
        g.closePath();
      });
      for (let i = 0; i < (big ? 3 : 2); i++) {
        const rr2 = r * (0.75 - i * 0.2);
        g.strokeStyle = "#c88a3c";
        lw(g, r * 0.11);
        g.beginPath();
        g.arc(0, 0, rr2, 0, Math.PI * 2);
        g.stroke();
        g.strokeStyle = "#6a3e14";
        lw(g, r * 0.03);
        g.beginPath();
        g.arc(0, 0, rr2, 0, Math.PI * 2);
        g.stroke();
      }
      for (let i = 0; i < 4; i++) {
        const a = i / 4 * Math.PI * 2 + Math.PI / 4;
        shape(g, METAL.light, o * 0.4, () => g.arc(Math.cos(a) * r * 0.85, Math.sin(a) * r * 0.85, r * 0.1, 0, Math.PI * 2));
      }
      shape(g, "#dff3ff", o * 0.6, () => g.arc(0, 0, r * 0.28, 0, Math.PI * 2));
      glowDot(g, 0, 0, r * 0.18, glow);
      break;
    }
    case "emp": {
      const len = r * 1.45;
      for (const s of [-1, 1]) shape(g, METAL.light, o, () => {
        g.moveTo(r * 0.2, s * r * 0.15);
        g.lineTo(len, s * r * 0.32);
        g.lineTo(len, s * r * 0.18);
        g.lineTo(r * 0.35, s * r * 0.02);
        g.closePath();
      });
      glowDot(g, len * 0.85, 0, r * 0.14, glow);
      shape(g, teamGrad(g, pal, r), o, () => g.arc(-r * 0.1, 0, r * 0.75, 0, Math.PI * 2));
      shape(g, "#1c2a3a", o * 0.6, () => g.arc(-r * 0.1, 0, r * 0.45, 0, Math.PI * 2));
      g.strokeStyle = glow;
      lw(g, r * 0.06);
      g.beginPath();
      g.arc(-r * 0.1, 0, r * 0.32, 0, Math.PI * 2);
      g.stroke();
      glowDot(g, -r * 0.1, 0, r * 0.12, glow);
      break;
    }
    case "slowbeam": {
      shape(g, METAL.dark, o, () => roundRect(g, 0, -r * 0.14, r * 1.1, r * 0.28, r * 0.1));
      for (const x of [0.45, 0.75]) shape(g, METAL.light, o * 0.4, () => g.ellipse(x * r, 0, r * 0.06, r * 0.3, 0, 0, Math.PI * 2));
      shape(g, rgba(glow, 0.95), o * 0.6, () => {
        g.moveTo(r * 1.45, 0);
        g.lineTo(r * 1.15, -r * 0.18);
        g.lineTo(r * 0.95, 0);
        g.lineTo(r * 1.15, r * 0.18);
        g.closePath();
      });
      glowDot(g, r * 1.2, 0, r * 0.12, glow);
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 0.85, -r * 0.7, r * 1.15, r * 1.4, r * 0.45));
      shape(g, rgba(glow, 0.7), o * 0.4, () => g.arc(-r * 0.3, 0, r * 0.25, 0, Math.PI * 2));
      break;
    }
    case "flak": {
      const nb = n > 1 ? n : 2;
      const bw = r * 0.22;
      const len = r * 1.75;
      for (const y of spreadOffsets(nb, r * (nb >= 3 ? 1 : 0.55))) {
        barrel(g, 0, len, y, bw, o);
        muzzle(g, len, y, bw * 1.5, bw * 1.6, o * 0.6);
      }
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 0.95, -r * 0.9, r * 1.5, r * 1.8, r * 0.5));
      shape(g, METAL.light, o * 0.6, () => g.ellipse(-r * 0.55, 0, r * 0.18, r * 0.5, 0, 0, Math.PI * 2));
      g.strokeStyle = METAL.dark;
      lw(g, r * 0.05);
      g.beginPath();
      g.moveTo(-r * 0.55, -r * 0.45);
      g.lineTo(-r * 0.55, r * 0.45);
      g.stroke();
      shape(g, pal.accent, 0, () => g.arc(r * 0.15, 0, r * 0.12, 0, Math.PI * 2));
      break;
    }
    case "repair": {
      shape(g, METAL.base, o, () => roundRect(g, 0, -r * 0.13, r * 1, r * 0.26, r * 0.1));
      shape(g, METAL.dark, o * 0.6, () => g.arc(r * 1, 0, r * 0.2, 0, Math.PI * 2));
      glowDot(g, r * 1.05, 0, r * 0.1, glow);
      shape(g, teamGrad(g, pal, r), o, () => g.arc(-r * 0.1, 0, r * 0.78, 0, Math.PI * 2));
      shape(g, "#f2f2ea", o * 0.5, () => g.arc(-r * 0.1, 0, r * 0.5, 0, Math.PI * 2));
      g.fillStyle = "#2bd46a";
      g.fillRect(-r * 0.4, -r * 0.1, r * 0.6, r * 0.2);
      g.fillRect(-r * 0.2, -r * 0.3, r * 0.2, r * 0.6);
      break;
    }
    case "shield": {
      shape(g, METAL.dark, o, () => g.arc(0, 0, r * 0.95, 0, Math.PI * 2));
      const gr = g.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.05, 0, 0, r * 0.8);
      gr.addColorStop(0, "#ffffff");
      gr.addColorStop(0.35, glow);
      gr.addColorStop(1, shade(pal.dark, -0.2));
      shape(g, gr, o * 0.6, () => g.arc(0, 0, r * 0.72, 0, Math.PI * 2));
      g.strokeStyle = "rgba(255,255,255,0.45)";
      lw(g, r * 0.04);
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * Math.PI * 2;
        g.moveTo(0, 0);
        g.lineTo(Math.cos(a) * r * 0.72, Math.sin(a) * r * 0.72);
      }
      g.stroke();
      for (let i = 0; i < 4; i++) {
        const a = i / 4 * Math.PI * 2;
        shape(g, pal.accent, o * 0.4, () => g.arc(Math.cos(a) * r * 0.86, Math.sin(a) * r * 0.86, r * 0.08, 0, Math.PI * 2));
      }
      break;
    }
    case "sonic": {
      shape(g, metalGrad(g, r, METAL.light), o, () => {
        g.moveTo(r * 0.1, -r * 0.25);
        g.lineTo(r * 1.3, -r * 0.8);
        g.quadraticCurveTo(r * 1.45, 0, r * 1.3, r * 0.8);
        g.lineTo(r * 0.1, r * 0.25);
        g.closePath();
      });
      shape(g, METAL.deep, 0, () => g.ellipse(r * 1.28, 0, r * 0.12, r * 0.7, 0, 0, Math.PI * 2));
      g.strokeStyle = rgba(glow, 0.8);
      lw(g, r * 0.05);
      for (const x of [0.55, 0.85]) {
        g.beginPath();
        g.ellipse(x * r, 0, r * 0.06, r * (0.25 + (x - 0.1) * 0.45), 0, 0, Math.PI * 2);
        g.stroke();
      }
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 0.9, -r * 0.65, r * 1.1, r * 1.3, r * 0.35));
      shape(g, METAL.dark, o * 0.5, () => g.arc(-r * 0.35, 0, r * 0.3, 0, Math.PI * 2));
      shape(g, METAL.light, 0, () => g.arc(-r * 0.35, 0, r * 0.14, 0, Math.PI * 2));
      break;
    }
    case "gravity": {
      for (const s of [-1, 1]) shape(g, METAL.dark, o, () => {
        g.moveTo(-r * 0.1, s * r * 0.35);
        g.lineTo(r * 1.5, s * r * 0.42);
        g.lineTo(r * 1.6, s * r * 0.22);
        g.lineTo(r * 0.5, s * r * 0.16);
        g.closePath();
      });
      for (let i = 0; i < 3; i++) shape(g, "#5a2a8a", o * 0.5, () => g.ellipse(r * (0.6 + i * 0.3), 0, r * 0.07, r * 0.4, 0, 0, Math.PI * 2));
      const gg = g.createRadialGradient(r * 1.1, 0, 0, r * 1.1, 0, r * 0.35);
      gg.addColorStop(0, "#000000");
      gg.addColorStop(0.5, "#3a0066");
      gg.addColorStop(1, "rgba(160,80,255,0)");
      g.fillStyle = gg;
      g.beginPath();
      g.arc(r * 1.1, 0, r * 0.35, 0, Math.PI * 2);
      g.fill();
      shape(g, teamGrad(g, pal, r), o, () => {
        for (let i = 0; i < 8; i++) {
          const a = i / 8 * Math.PI * 2 + Math.PI / 8;
          const f = i === 0 ? g.moveTo.bind(g) : g.lineTo.bind(g);
          f(Math.cos(a) * r * 0.95 - r * 0.15, Math.sin(a) * r * 0.95);
        }
        g.closePath();
      });
      shape(g, "#1a0a2a", o * 0.6, () => g.arc(-r * 0.15, 0, r * 0.45, 0, Math.PI * 2));
      glowDot(g, -r * 0.15, 0, r * 0.15, "#b070ff");
      break;
    }
    case "saw": {
      shape(g, METAL.dark, o, () => roundRect(g, 0, -r * 0.16, r * 1.1, r * 0.32, r * 0.1));
      const R2 = r * 0.75, cx = r * 1.25;
      shape(g, metalGrad(g, R2, "#9aa2aa"), o, () => {
        for (let i = 0; i < 16; i++) {
          const a = i / 16 * Math.PI * 2;
          const f = i === 0 ? g.moveTo.bind(g) : g.lineTo.bind(g);
          f(cx + Math.cos(a) * R2, Math.sin(a) * R2);
          f(cx + Math.cos(a + 0.2) * R2 * 0.85, Math.sin(a + 0.2) * R2 * 0.85);
        }
        g.closePath();
      });
      shape(g, METAL.dark, o * 0.5, () => g.arc(cx, 0, R2 * 0.3, 0, Math.PI * 2));
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 0.8, -r * 0.6, r * 1, r * 1.2, r * 0.3));
      break;
    }
    case "chainsaw": {
      const len = r * 2.1;
      shape(g, METAL.light, o, () => roundRect(g, r * 0.1, -r * 0.26, len, r * 0.52, r * 0.26));
      g.strokeStyle = METAL.dark;
      lw(g, r * 0.08);
      g.setLineDash([r * 0.1, r * 0.08]);
      g.beginPath();
      roundRect(g, r * 0.12, -r * 0.24, len - r * 0.04, r * 0.48, r * 0.24);
      g.stroke();
      g.setLineDash([]);
      shape(g, "#d4a020", o * 0.6, () => roundRect(g, -r * 0.2, -r * 0.4, r * 0.5, r * 0.8, r * 0.1));
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 0.85, -r * 0.55, r * 0.8, r * 1.1, r * 0.3));
      break;
    }
    case "hammer": {
      shape(g, METAL.dark, o, () => roundRect(g, 0, -r * 0.12, r * 1.3, r * 0.24, r * 0.08));
      shape(g, metalGrad(g, r, METAL.base), o, () => roundRect(g, r * 1.1, -r * 0.6, r * 0.55, r * 1.2, r * 0.1));
      g.fillStyle = "rgba(255,255,255,0.25)";
      g.fillRect(r * 1.18, -r * 0.5, r * 0.1, r);
      shape(g, pal.accent, 0, () => g.rect(r * 1.1, -r * 0.6, r * 0.55, r * 0.12));
      shape(g, teamGrad(g, pal, r), o, () => g.arc(0, 0, r * 0.7, 0, Math.PI * 2));
      hatch(g, -r * 0.1, 0, r * 0.25, o);
      break;
    }
    case "claw": {
      for (const s of [-1, 1]) {
        shape(g, METAL.base, o, () => {
          g.moveTo(r * 0.2, s * r * 0.2);
          g.lineTo(r * 1, s * r * 0.55);
          g.quadraticCurveTo(r * 1.7, s * r * 0.45, r * 1.75, s * r * 0.05);
          g.lineTo(r * 1.45, s * r * 0.15);
          g.quadraticCurveTo(r * 1.25, s * r * 0.3, r * 0.9, s * r * 0.25);
          g.lineTo(r * 0.3, s * r * 0.02);
          g.closePath();
        });
      }
      joint(g, r * 0.95, -r * 0.42, r * 0.1, o);
      joint(g, r * 0.95, r * 0.42, r * 0.1, o);
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 0.85, -r * 0.6, r * 1.15, r * 1.2, r * 0.35));
      break;
    }
    case "blade": {
      const len = r * 2.2;
      g.globalAlpha = 0.5;
      shape(g, glow, 0, () => {
        g.moveTo(r * 0.4, -r * 0.3);
        g.lineTo(len + r * 0.2, 0);
        g.lineTo(r * 0.4, r * 0.3);
        g.closePath();
      });
      g.globalAlpha = 1;
      shape(g, "#ffffff", 0, () => {
        g.moveTo(r * 0.5, -r * 0.12);
        g.lineTo(len, 0);
        g.lineTo(r * 0.5, r * 0.12);
        g.closePath();
      });
      shape(g, METAL.dark, o, () => roundRect(g, r * 0.1, -r * 0.35, r * 0.4, r * 0.7, r * 0.1));
      shape(g, teamGrad(g, pal, r), o, () => g.arc(-r * 0.2, 0, r * 0.65, 0, Math.PI * 2));
      glowDot(g, -r * 0.2, 0, r * 0.12, glow);
      break;
    }
    case "drill": {
      shape(g, metalGrad(g, r, METAL.light), o, () => {
        g.moveTo(r * 0.3, -r * 0.5);
        g.lineTo(r * 2, 0);
        g.lineTo(r * 0.3, r * 0.5);
        g.closePath();
      });
      g.strokeStyle = METAL.dark;
      lw(g, r * 0.07);
      g.beginPath();
      for (let i = 0; i < 5; i++) {
        const x = r * (0.45 + i * 0.3), h = r * 0.5 * (1 - (x - r * 0.3) / (r * 1.7));
        g.moveTo(x, -h);
        g.lineTo(x + r * 0.18, h);
      }
      g.stroke();
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 0.85, -r * 0.65, r * 1.2, r * 1.3, r * 0.3));
      break;
    }
    case "prod": {
      shape(g, METAL.dark, o, () => roundRect(g, 0, -r * 0.1, r * 1.7, r * 0.2, r * 0.08));
      for (const s of [-1, 1]) shape(g, METAL.light, o * 0.6, () => roundRect(g, r * 1.6, s * r * 0.18 - r * 0.05, r * 0.3, r * 0.1, r * 0.04));
      glowDot(g, r * 1.85, 0, r * 0.1, "#a8d8ff");
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 0.75, -r * 0.5, r * 1, r * 1, r * 0.3));
      break;
    }
    case "ram": {
      shape(g, metalGrad(g, r, METAL.base), o, () => {
        g.moveTo(r * 0.2, -r * 1);
        g.lineTo(r * 0.9, -r * 0.8);
        g.lineTo(r * 1.25, 0);
        g.lineTo(r * 0.9, r * 0.8);
        g.lineTo(r * 0.2, r * 1);
        g.closePath();
      });
      g.strokeStyle = "rgba(240,190,40,0.8)";
      lw(g, r * 0.12);
      g.beginPath();
      for (let i = -2; i <= 2; i++) {
        g.moveTo(r * 0.45, i * r * 0.35 - r * 0.1);
        g.lineTo(r * 0.75, i * r * 0.35 + r * 0.1);
      }
      g.stroke();
      rivets(g, [r * 0.35, -r * 0.7, r * 0.35, r * 0.7, r * 0.35, 0], r * 0.07);
      break;
    }
    case "cloak": {
      shape(g, teamGrad(g, pal, r), o, () => g.arc(0, 0, r * 0.8, 0, Math.PI * 2));
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, r * 0.6);
      gr.addColorStop(0, "#e8f8ff");
      gr.addColorStop(0.5, "#6aa8c8");
      gr.addColorStop(1, "#1a2a38");
      shape(g, gr, o * 0.5, () => g.arc(0, 0, r * 0.55, 0, Math.PI * 2));
      g.strokeStyle = "rgba(200,240,255,0.6)";
      lw(g, r * 0.05);
      for (let i = 0; i < 3; i++) {
        g.beginPath();
        g.arc(0, 0, r * (0.2 + i * 0.13), i, i + 3.5);
        g.stroke();
      }
      break;
    }
    case "jammer": {
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 0.7, -r * 0.6, r * 1.2, r * 1.2, r * 0.25));
      shape(g, metalGrad(g, r, METAL.light), o, () => g.arc(r * 0.05, 0, r * 0.5, 0, Math.PI * 2));
      shape(g, METAL.dark, 0, () => g.arc(r * 0.05, 0, r * 0.3, 0, Math.PI * 2));
      g.strokeStyle = METAL.light;
      lw(g, r * 0.06);
      g.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = i * 2.09;
        g.moveTo(r * 0.05, 0);
        g.lineTo(r * 0.05 + Math.cos(a) * r * 0.85, Math.sin(a) * r * 0.85);
      }
      g.stroke();
      glowDot(g, r * 0.05, 0, r * 0.08, "#ff5050");
      break;
    }
    case "smoke": {
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 0.7, -r * 0.7, r * 1.2, r * 1.4, r * 0.25));
      for (let i = 0; i < 4; i++) {
        const y = -r * 0.48 + i * r * 0.32;
        shape(g, METAL.dark, o * 0.5, () => g.arc(r * 0.25, y, r * 0.13, 0, Math.PI * 2));
        shape(g, "#8a8a80", 0, () => g.arc(r * 0.27, y, r * 0.07, 0, Math.PI * 2));
      }
      break;
    }
    case "pointdef": {
      for (const y of [-r * 0.2, r * 0.2]) barrel(g, 0, r * 1.3, y, r * 0.14, o, METAL.dark);
      glowDot(g, r * 1.3, -r * 0.2, r * 0.06, "#ff6060");
      glowDot(g, r * 1.3, r * 0.2, r * 0.06, "#ff6060");
      shape(g, teamGrad(g, pal, r), o, () => g.arc(0, 0, r * 0.6, 0, Math.PI * 2));
      shape(g, METAL.light, o * 0.5, () => g.ellipse(-r * 0.15, 0, r * 0.12, r * 0.35, 0, 0, Math.PI * 2));
      break;
    }
    case "engine": {
      shape(g, METAL.dark, o, () => roundRect(g, -r * 0.9, -r * 0.6, r * 1.6, r * 1.2, r * 0.2));
      for (const y of [-0.3, 0.3]) {
        shape(g, METAL.base, o * 0.6, () => g.arc(-r * 0.75, y * r, r * 0.22, 0, Math.PI * 2));
        shape(g, "#2a1408", 0, () => g.arc(-r * 0.75, y * r, r * 0.13, 0, Math.PI * 2));
        glowDot(g, -r * 0.75, y * r, r * 0.06, "#ff9030");
      }
      vents2(g, r * 0.1, 0, r * 0.8, r * 0.9, 5, o);
      shape(g, pal.accent, 0, () => g.rect(r * 0.55, -r * 0.6, r * 0.12, r * 1.2));
      break;
    }
    case "uplink": {
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 0.6, -r * 0.6, r * 1.2, r * 1.2, r * 0.2));
      g.strokeStyle = METAL.light;
      lw(g, r * 0.07);
      g.beginPath();
      for (const [x, y] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) {
        g.moveTo(x * r, y * r);
        g.lineTo(x * r * 2.2, y * r * 2.2);
      }
      g.stroke();
      for (const [x, y] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) glowDot(g, x * r * 2.2, y * r * 2.2, r * 0.06, pal.glow);
      shape(g, METAL.light, o * 0.5, () => g.arc(0, 0, r * 0.25, 0, Math.PI * 2));
      break;
    }
    case "charge": {
      shape(g, "#5a4a2a", o, () => roundRect(g, -r * 0.8, -r * 0.6, r * 1.6, r * 1.2, r * 0.15));
      for (const x of [-0.45, 0, 0.45]) shape(g, "#8a6a3a", o * 0.5, () => roundRect(g, x * r - r * 0.18, -r * 0.5, r * 0.36, r, r * 0.12));
      g.strokeStyle = "#c0392b";
      lw(g, r * 0.06);
      g.beginPath();
      g.moveTo(-r * 0.7, 0);
      g.bezierCurveTo(-r * 0.2, -r * 0.6, r * 0.2, r * 0.6, r * 0.7, 0);
      g.stroke();
      glowDot(g, r * 0.6, -r * 0.45, r * 0.06, "#ff3030");
      break;
    }
    case "gyro": {
      shape(g, teamGrad(g, pal, r), o, () => g.arc(0, 0, r * 0.8, 0, Math.PI * 2));
      g.strokeStyle = METAL.light;
      lw(g, r * 0.08);
      g.beginPath();
      g.ellipse(0, 0, r * 0.6, r * 0.25, 0.6, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.ellipse(0, 0, r * 0.6, r * 0.25, -0.6, 0, Math.PI * 2);
      g.stroke();
      shape(g, METAL.dark, o * 0.5, () => g.arc(0, 0, r * 0.18, 0, Math.PI * 2));
      break;
    }
    case "coolant": {
      for (const y of [-0.35, 0.35]) shape(g, "#3a8ab0", o, () => roundRect(g, -r * 0.9, y * r - r * 0.25, r * 1.6, r * 0.5, r * 0.25));
      g.fillStyle = "rgba(255,255,255,0.35)";
      for (const y of [-0.35, 0.35]) g.fillRect(-r * 0.7, y * r - r * 0.15, r * 1.2, r * 0.08);
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 0.3, -r * 0.55, r * 0.5, r * 1.1, r * 0.1));
      break;
    }
    case "dome": {
      shape(g, METAL.dark, o, () => {
        for (let i = 0; i < 6; i++) {
          const a = i / 6 * Math.PI * 2;
          const f = i === 0 ? g.moveTo.bind(g) : g.lineTo.bind(g);
          f(Math.cos(a) * r, Math.sin(a) * r);
        }
        g.closePath();
      });
      const gr = g.createRadialGradient(-r * 0.25, -r * 0.25, 0, 0, 0, r * 0.75);
      gr.addColorStop(0, "#ffffff");
      gr.addColorStop(0.4, "#7fd8ff");
      gr.addColorStop(1, "#1a4a6a");
      shape(g, gr, o * 0.6, () => g.arc(0, 0, r * 0.72, 0, Math.PI * 2));
      g.strokeStyle = "rgba(255,255,255,0.5)";
      lw(g, r * 0.04);
      g.beginPath();
      g.arc(0, 0, r * 0.5, 0, Math.PI * 2);
      g.moveTo(-r * 0.72, 0);
      g.lineTo(r * 0.72, 0);
      g.moveTo(0, -r * 0.72);
      g.lineTo(0, r * 0.72);
      g.stroke();
      break;
    }
    case "nanite": {
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 0.7, -r * 0.7, r * 1.4, r * 1.4, r * 0.4));
      shape(g, "#1a2a20", o * 0.5, () => g.arc(0, 0, r * 0.5, 0, Math.PI * 2));
      g.fillStyle = "#6dff9a";
      for (let i = 0; i < 9; i++) {
        const a = i * 2.4, d = r * 0.12 * Math.sqrt(i);
        g.beginPath();
        g.arc(Math.cos(a) * d, Math.sin(a) * d, r * 0.06, 0, Math.PI * 2);
        g.fill();
      }
      break;
    }
    case "sensor": {
      shape(g, teamGrad(g, pal, r), o, () => roundRect(g, -r * 0.7, -r * 0.55, r * 1.2, r * 1.1, r * 0.25));
      shape(g, metalGrad(g, r, METAL.light), o, () => {
        g.ellipse(r * 0.2, 0, r * 0.35, r * 0.85, 0, -Math.PI / 2, Math.PI / 2);
        g.closePath();
      });
      g.strokeStyle = METAL.dark;
      lw(g, r * 0.06);
      g.beginPath();
      g.moveTo(r * 0.2, 0);
      g.lineTo(r * 0.7, 0);
      g.stroke();
      glowDot(g, r * 0.72, 0, r * 0.08, "#ff5050");
      g.strokeStyle = METAL.light;
      lw(g, r * 0.05);
      g.beginPath();
      g.moveTo(-r * 0.45, -r * 0.3);
      g.lineTo(-r * 0.45, -r * 0.9);
      g.stroke();
      break;
    }
    default: {
      barrel(g, 0, r * 1.6, 0, r * 0.25, o);
      shape(g, teamGrad(g, pal, r), o, () => g.arc(0, 0, r * 0.8, 0, Math.PI * 2));
    }
  }
}

// src/client/render/unitart.ts
var SHAPE_HW = {
  wedge: 0.26,
  pod: 0.24,
  box: 0.28,
  hex: 0.3,
  cross: 0.3,
  long: 0.2,
  round: 0.34,
  airframe: 0.14,
  fortress: 0.4,
  titan: 0.3
};
var MOUNT_PTS = {
  scout: [[0.02, 0]],
  drone: [[0.04, 0]],
  raider: [[0.06, -0.14], [0.06, 0.14]],
  warden: [[0.05, 0], [-0.25, 0.15]],
  striker: [[-0.02, -0.25], [-0.02, 0.25], [0.22, 0]],
  longarm: [[0.04, 0]],
  aegis: [[0.06, 0], [-0.22, 0]],
  gunship: [[-0.03, -0.28], [-0.03, 0.28]],
  bastion: [[0.06, 0], [-0.24, -0.25], [-0.24, 0.25]],
  colossus: [[0, -0.31], [0, 0.31], [0.18, 0], [-0.24, 0]]
};
var CLASS_D = { L: 0.36, M: 0.5, H: 0.64 };
var layoutCache = /* @__PURE__ */ new Map();
var designKey = (d) => `${d.chassis}|${d.mobility}|${d.mounts.map((m) => m ?? "-").join(",")}`;
function layoutOf(d) {
  const key = designKey(d);
  let L = layoutCache.get(key);
  if (L) return L;
  const chassis = CHASSIS_BY_ID.get(d.chassis) ?? CHASSIS_BY_ID.get("scout");
  const mob = MOBILITY_BY_ID.get(d.mobility) ?? MOBILITY_BY_ID.get("wheels");
  const S = chassis.size;
  const shape2 = chassis.shape;
  const pts = MOUNT_PTS[chassis.id] ?? chassis.mounts.map((_, i, a) => [0.05 - 0.25 * Math.floor(i / 2), a.length === 1 ? 0 : i % 2 ? 0.2 : -0.2]);
  const mounts = chassis.mounts.map((slot, i) => {
    const id = d.mounts[i] ?? null;
    const mod = id ? MODULE_BY_ID.get(id) ?? null : null;
    const cls = mod?.mount ?? slot;
    const cal2 = mod?.caliber ?? 0.5;
    const p = pts[i] ?? [0, 0];
    const dd = CLASS_D[cls] * (0.8 + 0.4 * cal2) * (1 + 0.12 * (S - 1));
    return { x: p[0] * S, y: p[1] * S, slot, mod, d: dd, turret: !!mod && mod.kind !== "armor" && mod.visual !== "plate" };
  });
  const air = mob.kind === "air";
  const quad = mob.id === "rotor" && (chassis.id === "drone" || shape2 === "pod" || shape2 === "round");
  const rotors = [];
  const nozzles = [];
  if (mob.id === "rotor") {
    if (quad) for (const sx of [-1, 1]) for (const sy of [-1, 1]) rotors.push({ x: sx * 0.32 * S, y: sy * 0.32 * S, r: 0.2 * S, blades: 2 });
    else if (S >= 2 && shape2 === "airframe") {
      rotors.push({ x: 0.22 * S, y: 0, r: 0.42 * S, blades: 3 });
      rotors.push({ x: -0.3 * S, y: 0, r: 0.38 * S, blades: 3 });
    } else rotors.push({ x: 0, y: 0, r: 0.52 * S, blades: 3 });
  }
  if (mob.id === "jet") for (const sy of [-1, 1]) nozzles.push({ x: -0.5 * S, y: sy * 0.13 * S, w: 0.09 * S });
  if (mob.id === "jumpjets") for (const sy of [-1, 1]) nozzles.push({ x: -0.4 * S, y: sy * 0.15 * S, w: 0.07 * S });
  const legged = mob.id === "legs" || mob.id === "spider" || mob.id === "jumpjets";
  const rolled = mob.id === "treads" || mob.id === "wheels" || mob.id === "halftrack";
  L = {
    key,
    S,
    chassis,
    mob,
    shape: shape2,
    hw: SHAPE_HW[shape2] ?? 0.28,
    mounts,
    air,
    quad,
    rotors,
    nozzles,
    ext: 0.8 * S,
    frames: legged ? 8 : rolled ? 4 : 1,
    cycle: mob.id === "legs" ? 0.75 * S : mob.id === "spider" ? 0.55 * S : mob.id === "jumpjets" ? 0.8 * S : mob.id === "treads" || mob.id === "halftrack" ? 0.09 * S : 0.06 * S
  };
  layoutCache.set(key, L);
  return L;
}
function hullPath(shape2, S) {
  const p = new Path2D();
  switch (shape2) {
    case "wedge":
      poly(p, mirrorPoly([0.44, 0, 0.12, -0.16, -0.18, -0.26, -0.36, -0.26, -0.42, -0.17, -0.4, 0]), S);
      break;
    case "pod":
      p.ellipse(0, 0, 0.3 * S, 0.24 * S, 0, 0, Math.PI * 2);
      break;
    case "box":
      poly(p, mirrorPoly([0.39, -0.17, 0.3, -0.28, -0.36, -0.28, -0.41, -0.22]), S);
      break;
    case "hex":
      poly(p, mirrorPoly([0.43, -0.1, 0.27, -0.3, -0.33, -0.3, -0.43, -0.16]), S);
      break;
    case "cross":
      poly(p, mirrorPoly([0.45, -0.08, 0.34, -0.15, 0.13, -0.15, 0.1, -0.36, -0.15, -0.36, -0.18, -0.15, -0.38, -0.15, -0.44, -0.08]), S);
      break;
    case "long":
      poly(p, mirrorPoly([0.47, -0.07, 0.38, -0.18, -0.38, -0.2, -0.46, -0.12]), S);
      break;
    case "round":
      p.arc(0, 0, 0.34 * S, 0, Math.PI * 2);
      break;
    case "airframe":
      poly(p, mirrorPoly([0.49, 0, 0.38, -0.08, 0.12, -0.13, 0.04, -0.4, -0.12, -0.42, -0.15, -0.13, -0.34, -0.08, -0.42, -0.21, -0.49, -0.21, -0.47, -0.05, -0.48, 0]), S);
      break;
    case "fortress":
      poly(p, mirrorPoly([0.45, -0.2, 0.35, -0.41, -0.36, -0.41, -0.45, -0.3]), S);
      break;
    case "titan":
      poly(p, mirrorPoly([0.33, -0.12, 0.22, -0.2, 0.2, -0.45, -0.18, -0.45, -0.21, -0.22, -0.36, -0.17, -0.42, -0.08]), S);
      break;
  }
  return p;
}
function paintHull(g, path, pal, S, o, hw) {
  const gr = g.createLinearGradient(-0.3 * S, -hw * S * 1.2, 0.3 * S, hw * S * 1.2);
  gr.addColorStop(0, pal.light);
  gr.addColorStop(0.45, pal.body);
  gr.addColorStop(1, pal.dark);
  g.fillStyle = gr;
  g.fill(path);
  g.save();
  g.clip(path);
  const rg = g.createRadialGradient(-0.05 * S, -0.08 * S, 0, 0, 0, 0.55 * S);
  rg.addColorStop(0, "rgba(255,255,255,0.18)");
  rg.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = rg;
  g.fillRect(-S, -S, 2 * S, 2 * S);
  let seed = 17 + S * 31;
  const rnd3 = () => (seed = seed * 16807 % 2147483647) / 2147483647;
  for (let i = 0; i < 40 * S; i++) {
    g.fillStyle = rnd3() < 0.5 ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.07)";
    const x = (rnd3() - 0.5) * S, y = (rnd3() - 0.5) * S, r = (4e-3 + rnd3() * 0.014) * S;
    g.fillRect(x, y, r, r);
  }
  g.strokeStyle = "rgba(0,0,0,0.35)";
  g.lineWidth = 0.06 * S;
  g.stroke(path);
  g.restore();
  g.save();
  g.scale(0.84, 0.84);
  g.strokeStyle = "rgba(255,255,255,0.16)";
  g.lineWidth = o * 0.6;
  g.stroke(path);
  g.restore();
  g.strokeStyle = OUTLINE;
  g.lineWidth = o;
  g.lineJoin = "round";
  g.stroke(path);
}
function line(g, pts, S, color, w) {
  g.strokeStyle = color;
  g.lineWidth = w;
  g.beginPath();
  for (let i = 0; i < pts.length; i += 4) {
    g.moveTo(pts[i] * S, pts[i + 1] * S);
    g.lineTo(pts[i + 2] * S, pts[i + 3] * S);
  }
  g.stroke();
}
function dotAt(g, x, y, r, color) {
  g.fillStyle = color;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}
function vents(g, x, y, w, h, n, o) {
  g.fillStyle = "rgba(0,0,0,0.5)";
  g.beginPath();
  roundRect(g, x - w / 2, y - h / 2, w, h, Math.min(w, h) * 0.2);
  g.fill();
  g.strokeStyle = "rgba(255,255,255,0.2)";
  g.lineWidth = o * 0.35;
  g.beginPath();
  for (let i = 1; i < n; i++) {
    const xx = x - w / 2 + w * i / n;
    g.moveTo(xx, y - h / 2 + h * 0.15);
    g.lineTo(xx, y + h / 2 - h * 0.15);
  }
  g.stroke();
}
function headlights(g, x, y, r) {
  dotAt(g, x, -y, r * 1.6, "rgba(0,0,0,0.5)");
  dotAt(g, x, y, r * 1.6, "rgba(0,0,0,0.5)");
  dotAt(g, x, -y, r, "#fff3c4");
  dotAt(g, x, y, r, "#fff3c4");
}
function hullDetails(g, L, pal, o) {
  const S = L.S;
  const pl = "rgba(0,0,0,0.38)";
  const hl = "rgba(255,255,255,0.14)";
  const t = o * 0.45;
  switch (L.shape) {
    case "wedge":
      line(g, [0.3, 0, -0.1, -0.2, 0.3, 0, -0.1, 0.2], S, pl, t);
      line(g, [-0.3, -0.2, -0.3, 0.2], S, pl, t);
      vents(g, -0.36 * S, 0, 0.06 * S, 0.26 * S, 4, o);
      line(g, [0.2, -0.04, 0, -0.13, 0.2, 0.04, 0, 0.13], S, pal.accent, o * 0.9);
      break;
    case "pod":
      g.strokeStyle = pl;
      g.lineWidth = t;
      g.beginPath();
      g.ellipse(0, 0, 0.21 * S, 0.16 * S, 0, 0, Math.PI * 2);
      g.stroke();
      dotAt(g, 0.22 * S, 0, 0.05 * S, "#10161c");
      dotAt(g, 0.22 * S, 0, 0.028 * S, pal.glow);
      line(g, [-0.27, -0.07, -0.27, 0.07], S, pal.accent, o * 0.9);
      break;
    case "box":
      line(g, [0.28, -0.26, 0.28, 0.26, -0.26, -0.26, -0.26, 0.26, 0.28, 0, -0.26, 0], S, pl, t);
      vents(g, -0.33 * S, 0, 0.07 * S, 0.3 * S, 5, o);
      headlights(g, 0.36 * S, 0.19 * S, 0.025 * S);
      line(g, [0.33, -0.27, 0.33, -0.12, 0.33, 0.27, 0.33, 0.12], S, pal.accent, o * 1);
      break;
    case "hex":
      line(g, [0.27, -0.28, -0.33, -0.28, 0.27, 0.28, -0.33, 0.28, 0.3, -0.2, 0.3, 0.2], S, hl, t);
      line(g, [0.3, -0.2, 0.3, 0.2, -0.38, -0.12, -0.38, 0.12, 0.3, -0.2, 0.38, -0.08, 0.3, 0.2, 0.38, 0.08], S, pl, t);
      vents(g, -0.36 * S, -0, 0.06 * S, 0.22 * S, 4, o);
      headlights(g, 0.4 * S, 0.07 * S, 0.018 * S);
      line(g, [-0.2, -0.29, 0.1, -0.29, -0.2, 0.29, 0.1, 0.29], S, pal.accent, o * 0.9);
      break;
    case "cross":
      line(g, [0.12, -0.15, 0.12, 0.15, -0.16, -0.15, -0.16, 0.15, 0.1, -0.33, -0.15, -0.33, 0.1, 0.33, -0.15, 0.33], S, pl, t);
      vents(g, -0.36 * S, 0, 0.06 * S, 0.18 * S, 4, o);
      headlights(g, 0.42 * S, 0.05 * S, 0.016 * S);
      line(g, [0.08, -0.36, 0.08, -0.14, 0.08, 0.36, 0.08, 0.14], S, pal.accent, o * 0.9);
      break;
    case "long":
      line(g, [0.3, -0.17, 0.3, 0.17, -0.1, -0.19, -0.1, 0.19, -0.3, -0.19, -0.3, 0.19, 0.3, 0, 0.45, 0], S, pl, t);
      vents(g, -0.4 * S, 0, 0.05 * S, 0.2 * S, 4, o);
      for (let i = 0; i < 3; i++) dotAt(g, (-0.2 + i * 0.08) * S, 0.14 * S, 0.012 * S, "rgba(0,0,0,0.5)");
      line(g, [0.36, -0.15, 0.42, -0.06, 0.36, 0.15, 0.42, 0.06], S, pal.accent, o * 0.9);
      break;
    case "round":
      g.strokeStyle = pl;
      g.lineWidth = t;
      g.beginPath();
      g.arc(0, 0, 0.27 * S, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = hl;
      g.beginPath();
      g.arc(0, 0, 0.255 * S, Math.PI * 1, Math.PI * 1.6);
      g.stroke();
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * Math.PI * 2 + 0.2;
        dotAt(g, Math.cos(a) * 0.3 * S, Math.sin(a) * 0.3 * S, 0.012 * S, "rgba(0,0,0,0.5)");
      }
      g.strokeStyle = pal.accent;
      g.lineWidth = o;
      g.beginPath();
      g.arc(0, 0, 0.31 * S, -0.5, 0.5);
      g.stroke();
      headlights(g, 0.31 * S, 0.06 * S, 0.016 * S);
      break;
    case "airframe":
      g.fillStyle = "#132230";
      g.beginPath();
      g.ellipse(0.31 * S, 0, 0.08 * S, 0.045 * S, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = rgba(pal.glow, 0.55);
      g.beginPath();
      g.ellipse(0.33 * S, -0.012 * S, 0.04 * S, 0.018 * S, 0, 0, Math.PI * 2);
      g.fill();
      line(g, [0.1, -0.12, 0.1, 0.12, -0.15, -0.12, -0.15, 0.12, 0.04, -0.38, -0.1, -0.38, 0.04, 0.38, -0.1, 0.38], S, pl, t);
      line(g, [0, -0.4, -0.08, -0.4, 0, 0.4, -0.08, 0.4], S, pal.accent, o * 1.1);
      line(g, [-0.44, -0.19, -0.44, 0.19], S, pal.accent, o * 0.8);
      break;
    case "fortress":
      line(g, [0.32, -0.36, 0.32, 0.36, -0.32, -0.36, -0.32, 0.36, 0.32, -0.36, -0.32, -0.36, 0.32, 0.36, -0.32, 0.36], S, pl, t);
      line(g, [0.31, -0.35, -0.31, -0.35], S, hl, t);
      vents(g, -0.39 * S, -0.17 * S, 0.05 * S, 0.16 * S, 4, o);
      vents(g, -0.39 * S, 0.17 * S, 0.05 * S, 0.16 * S, 4, o);
      for (const x of [0.38, -0.39]) for (const y of [-0.37, 0.37]) dotAt(g, x * S, y * S, 0.014 * S, "rgba(0,0,0,0.55)");
      headlights(g, 0.43 * S, 0.12 * S, 0.016 * S);
      line(g, [0.4, -0.3, 0.4, -0.18, 0.4, 0.3, 0.4, 0.18], S, pal.accent, o * 1.2);
      break;
    case "titan":
      line(g, [0.2, -0.2, -0.2, -0.2, 0.2, 0.2, -0.2, 0.2, 0.2, -0.44, -0.18, -0.44, 0.2, 0.44, -0.18, 0.44], S, pl, t);
      vents(g, -0.36 * S, 0, 0.05 * S, 0.2 * S, 4, o);
      g.fillStyle = "#10161c";
      g.beginPath();
      g.ellipse(0.28 * S, 0, 0.035 * S, 0.08 * S, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = pal.glow;
      g.beginPath();
      g.ellipse(0.29 * S, 0, 0.015 * S, 0.06 * S, 0, 0, Math.PI * 2);
      g.fill();
      line(g, [0.18, -0.43, 0.18, -0.24, 0.18, 0.43, 0.18, 0.24], S, pal.accent, o * 1.1);
      break;
  }
}
function drawPlates(g, L, pal, o) {
  const S = L.S;
  let skirts = 0;
  let reactive = false;
  for (const m of L.mounts) {
    if (!m.mod || m.turret) continue;
    if (m.mod.id === "plateM") skirts = Math.max(skirts, 1);
    if (m.mod.id === "plateH") skirts = 2;
    if (m.mod.id === "reactive") reactive = true;
  }
  const plateCol = shade(pal.body, -0.15);
  const hw = Math.min(L.hw, 0.36);
  const len = L.shape === "airframe" ? 0.3 : 0.62;
  if (skirts) {
    const th = skirts === 2 ? 0.08 : 0.055;
    for (const s of [-1, 1]) {
      const y = s * (hw + th * 0.3) * S;
      g.beginPath();
      roundRect(g, -len / 2 * S, y - th / 2 * S, len * S, th * S, th * 0.25 * S);
      g.fillStyle = skirts === 2 ? shade(plateCol, -0.1) : plateCol;
      g.fill();
      g.lineWidth = o * 0.8;
      g.strokeStyle = OUTLINE;
      g.stroke();
      g.strokeStyle = "rgba(0,0,0,0.4)";
      g.lineWidth = o * 0.35;
      g.beginPath();
      const segs = skirts === 2 ? 3 : 5;
      for (let i = 1; i < segs; i++) {
        const x = (-len / 2 + len * i / segs) * S;
        g.moveTo(x, y - th / 2 * S);
        g.lineTo(x, y + th / 2 * S);
      }
      g.stroke();
      if (skirts === 2) for (let i = 0; i < segs; i++) dotAt(g, (-len / 2 + len * (i + 0.5) / segs) * S, y, th * 0.18 * S, "rgba(0,0,0,0.55)");
    }
    if (skirts === 2) {
      const nx = L.shape === "titan" ? 0.27 : L.shape === "round" ? 0.29 : 0.36;
      g.beginPath();
      roundRect(g, (nx - 0.05) * S, -0.18 * S, 0.085 * S, 0.36 * S, 0.02 * S);
      g.fillStyle = shade(plateCol, -0.1);
      g.fill();
      g.lineWidth = o * 0.8;
      g.strokeStyle = OUTLINE;
      g.stroke();
    }
  }
  if (reactive) {
    const n = Math.max(3, Math.round(len * 8));
    const tw = len / n * S;
    for (const s of [-1, 1]) for (let i = 0; i < n; i++) {
      const x = -len / 2 * S + i * tw, y = s * (hw - 0.02) * S;
      g.beginPath();
      roundRect(g, x + tw * 0.08, y - tw * 0.42, tw * 0.84, tw * 0.84, tw * 0.12);
      g.fillStyle = "#7a7a52";
      g.fill();
      g.lineWidth = o * 0.5;
      g.strokeStyle = OUTLINE;
      g.stroke();
      dotAt(g, x + tw * 0.5, y, tw * 0.12, "#c0392b");
    }
  }
  for (const m of L.mounts) {
    if (!m.mod || m.turret) continue;
    const id = m.mod.id;
    const w = m.d * 1.3, h = m.d * 1.1;
    g.save();
    g.translate(m.x, m.y);
    if (id === "reactive") {
      for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) {
        const tx = -w / 2 + j * w / 3, ty = -h / 2 + i * h / 2;
        g.beginPath();
        roundRect(g, tx + w * 0.02, ty + h * 0.03, w / 3 - w * 0.04, h / 2 - h * 0.06, w * 0.04);
        g.fillStyle = (i + j) % 2 ? "#7a7a52" : "#6a6a46";
        g.fill();
        g.lineWidth = o * 0.6;
        g.strokeStyle = OUTLINE;
        g.stroke();
        dotAt(g, tx + w / 6, ty + h / 4, m.d * 0.05, "#c0392b");
      }
    } else if (id === "mirror") {
      g.beginPath();
      roundRect(g, -w / 2, -h / 2, w, h, h * 0.25);
      const gr = g.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
      gr.addColorStop(0, "#f4f8fc");
      gr.addColorStop(0.35, "#9aa8b8");
      gr.addColorStop(0.5, "#ffffff");
      gr.addColorStop(0.65, "#8a98a8");
      gr.addColorStop(1, "#c8d4e0");
      g.fillStyle = gr;
      g.fill();
      g.lineWidth = o * 0.8;
      g.strokeStyle = OUTLINE;
      g.stroke();
      g.strokeStyle = "rgba(255,255,255,0.9)";
      g.lineWidth = o * 0.6;
      g.beginPath();
      g.moveTo(-w * 0.3, h * 0.35);
      g.lineTo(w * 0.1, -h * 0.35);
      g.moveTo(-w * 0.05, h * 0.35);
      g.lineTo(w * 0.3, -h * 0.25);
      g.stroke();
    } else if (id === "plateM") {
      for (let i = 0; i < 3; i++) {
        const yy = -h / 2 + i * h / 3;
        g.beginPath();
        roundRect(g, -w / 2 + (i === 1 ? w * 0.06 : 0), yy, w - (i === 1 ? w * 0.06 : 0), h / 3, h * 0.06);
        g.fillStyle = i === 1 ? shade(pal.dark, 0.05) : shade(pal.light, -0.15);
        g.fill();
        g.lineWidth = o * 0.6;
        g.strokeStyle = OUTLINE;
        g.stroke();
      }
    } else if (id === "plateH") {
      g.beginPath();
      roundRect(g, -w * 0.6, -h * 0.6, w * 1.2, h * 1.2, h * 0.12);
      const gr = g.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
      gr.addColorStop(0, shade(pal.light, -0.25));
      gr.addColorStop(1, shade(pal.deep, 0.1));
      g.fillStyle = gr;
      g.fill();
      g.lineWidth = o * 1.1;
      g.strokeStyle = OUTLINE;
      g.stroke();
      g.beginPath();
      roundRect(g, -w * 0.42, -h * 0.42, w * 0.84, h * 0.84, h * 0.08);
      g.strokeStyle = "rgba(0,0,0,0.45)";
      g.lineWidth = o * 0.6;
      g.stroke();
      const rv = Math.max(0.014, m.d * 0.055);
      for (let i = 0; i < 4; i++) for (const sy of [-1, 1]) {
        const x = -w * 0.5 + (i + 0.5) * (w / 4);
        dotAt(g, x, sy * h * 0.51, rv, "rgba(0,0,0,0.6)");
        dotAt(g, x - rv * 0.3, sy * h * 0.51 - rv * 0.3, rv * 0.5, "rgba(255,255,255,0.35)");
      }
    } else {
      g.beginPath();
      g.moveTo(-w / 2 + h * 0.2, -h / 2);
      g.lineTo(w / 2, -h / 2);
      g.lineTo(w / 2, h / 2);
      g.lineTo(-w / 2 + h * 0.2, h / 2);
      g.lineTo(-w / 2, 0);
      g.closePath();
      const gr = g.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
      gr.addColorStop(0, shade(pal.light, -0.1));
      gr.addColorStop(1, shade(pal.dark, -0.1));
      g.fillStyle = gr;
      g.fill();
      g.lineWidth = o * 0.8;
      g.strokeStyle = OUTLINE;
      g.stroke();
      const rv = Math.max(0.012, m.d * 0.05);
      for (const [x, y] of [[-0.3, -0.38], [0.4, -0.38], [-0.3, 0.38], [0.4, 0.38]]) {
        dotAt(g, x * w, y * h, rv, "rgba(0,0,0,0.55)");
        dotAt(g, x * w - rv * 0.3, y * h - rv * 0.3, rv * 0.5, "rgba(255,255,255,0.35)");
      }
    }
    g.restore();
  }
}
function hullUnderlay(g, L, pal, o) {
  const S = L.S;
  if (L.shape === "long") {
    g.strokeStyle = METAL.dark;
    g.lineWidth = 0.06 * S;
    g.beginPath();
    for (const s of [-1, 1]) {
      g.moveTo(0.22 * S, s * 0.12 * S);
      g.lineTo(0.3 * S, s * 0.36 * S);
      g.moveTo(-0.26 * S, s * 0.12 * S);
      g.lineTo(-0.34 * S, s * 0.36 * S);
    }
    g.stroke();
    for (const s of [-1, 1]) for (const x of [0.3, -0.34]) {
      g.beginPath();
      g.arc(x * S, s * 0.37 * S, 0.05 * S, 0, Math.PI * 2);
      g.fillStyle = METAL.base;
      g.fill();
      g.lineWidth = o * 0.7;
      g.strokeStyle = OUTLINE;
      g.stroke();
    }
  }
  if (L.shape === "titan") {
    for (const s of [-1, 1]) {
      g.beginPath();
      g.arc(0, s * 0.22 * S, 0.08 * S, 0, Math.PI * 2);
      g.fillStyle = METAL.dark;
      g.fill();
      g.lineWidth = o;
      g.strokeStyle = OUTLINE;
      g.stroke();
    }
  }
  void pal;
}
function rubberBand(g, x0, x1, y, w, phase, sp, o) {
  const band = new Path2D();
  roundRect(band, x0, y - w / 2, x1 - x0, w, w * 0.45);
  g.fillStyle = METAL.rubber;
  g.fill(band);
  g.save();
  g.clip(band);
  g.strokeStyle = METAL.rubberHi;
  g.lineWidth = sp * 0.45;
  g.beginPath();
  for (let x = x0 - sp + phase * sp; x < x1 + sp; x += sp) {
    g.moveTo(x, y - w / 2);
    g.lineTo(x, y + w / 2);
  }
  g.stroke();
  g.fillStyle = "rgba(255,255,255,0.08)";
  g.fillRect(x0, y - w / 2, x1 - x0, w * 0.25);
  g.restore();
  g.lineWidth = o;
  g.strokeStyle = OUTLINE;
  g.stroke(band);
}
function wheel(g, x, y, len, w, phase, o) {
  rubberBand(g, x - len / 2, x + len / 2, y, w, phase, len / 4, o);
  g.fillStyle = METAL.light;
  g.beginPath();
  g.ellipse(x, y, len * 0.18, w * 0.3, 0, 0, Math.PI * 2);
  g.fill();
}
function limb(g, pts, w, color, o) {
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.strokeStyle = OUTLINE;
  g.lineWidth = w + o * 2;
  g.stroke();
  g.strokeStyle = color;
  g.lineWidth = w;
  g.stroke();
  g.strokeStyle = "rgba(255,255,255,0.18)";
  g.lineWidth = w * 0.3;
  g.stroke();
}
function joint2(g, x, y, r, color, o) {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = color;
  g.fill();
  g.lineWidth = o * 0.7;
  g.strokeStyle = OUTLINE;
  g.stroke();
}
function foot(g, x, y, len, w, lift, o, color = METAL.base) {
  const k = 1 + lift * 0.18;
  g.beginPath();
  roundRect(g, x - len * k / 2, y - w * k / 2, len * k, w * k, w * 0.35);
  g.fillStyle = lift > 0.05 ? shade(color, 0.15 * lift) : color;
  g.fill();
  g.lineWidth = o * 0.8;
  g.strokeStyle = OUTLINE;
  g.stroke();
}
function drawMobility(g, L, pal, phase, rest, o) {
  const S = L.S;
  const id = L.mob.id;
  const P = Math.PI * 2;
  if (id === "treads") {
    const tc = Math.min(0.38, Math.max(0.3, L.hw + 0.06)) * S, tw = 0.19 * S;
    for (const s of [-1, 1]) {
      rubberBand(g, -0.47 * S, 0.47 * S, s * tc, tw, phase, 0.09 * S, o);
      for (const x of [-0.4, 0.4]) {
        g.fillStyle = METAL.base;
        g.beginPath();
        g.arc(x * S, s * tc, tw * 0.28, 0, P);
        g.fill();
      }
      g.fillStyle = "rgba(0,0,0,0.35)";
      g.fillRect(-0.42 * S, s * tc - tw * 0.08, 0.84 * S, tw * 0.16);
    }
  } else if (id === "wheels") {
    const xs = S === 1 ? [-0.27, 0.27] : [-0.32, 0, 0.32];
    const y = (S === 1 ? 0.3 : 0.34) * S;
    g.strokeStyle = METAL.dark;
    g.lineWidth = 0.05 * S;
    g.beginPath();
    for (const x of xs) {
      g.moveTo(x * S, -y);
      g.lineTo(x * S, y);
    }
    g.stroke();
    for (const x of xs) for (const s of [-1, 1]) wheel(g, x * S, s * y, 0.22 * S, 0.13 * S, phase, o);
  } else if (id === "halftrack") {
    const y = Math.min(0.36, L.hw + 0.05) * S;
    for (const s of [-1, 1]) rubberBand(g, -0.47 * S, 0.06 * S, s * y, 0.16 * S, phase, 0.08 * S, o);
    g.strokeStyle = METAL.dark;
    g.lineWidth = 0.05 * S;
    g.beginPath();
    g.moveTo(0.29 * S, -0.3 * S);
    g.lineTo(0.29 * S, 0.3 * S);
    g.stroke();
    for (const s of [-1, 1]) wheel(g, 0.29 * S, s * 0.3 * S, 0.2 * S, 0.12 * S, phase, o);
  } else if (id === "legs" || id === "jumpjets") {
    const jump = id === "jumpjets";
    const hy = 0.2 * S, fy = (jump ? 0.31 : 0.3) * S, stride = (jump ? 0.14 : 0.19) * S;
    for (const s of [-1, 1]) {
      const ph = phase * P + (s > 0 ? Math.PI : 0);
      const fx = rest ? (s > 0 ? 0.04 : -0.04) * S : Math.sin(ph) * stride;
      const lift = rest ? 0 : Math.max(0, Math.cos(ph));
      const kx = fx * 0.4 + (jump ? -0.12 : 0.06) * S, ky = s * (fy + 0.07 * S);
      limb(g, [0, s * hy, kx, ky, fx, s * fy], (jump ? 0.1 : 0.075) * S, jump ? METAL.dark : METAL.base, o);
      if (jump) limb(g, [kx * 0.5, s * hy, kx - 0.04 * S, ky - s * 0.02 * S], 0.035 * S, METAL.light, o * 0.6);
      joint2(g, kx, ky, 0.055 * S * (1 + lift * 0.15), jump ? pal.dark : METAL.light, o);
      foot(g, fx + 0.03 * S, s * fy, (jump ? 0.2 : 0.18) * S, 0.1 * S, lift, o, jump ? METAL.dark : METAL.base);
    }
    if (jump) for (const n of L.nozzles) {
      g.beginPath();
      roundRect(g, n.x, n.y - n.w, 0.16 * S, n.w * 2, n.w * 0.5);
      g.fillStyle = METAL.dark;
      g.fill();
      g.lineWidth = o;
      g.strokeStyle = OUTLINE;
      g.stroke();
      dotAt(g, n.x + 0.02 * S, n.y, n.w * 0.6, "#0a0a0a");
    }
  } else if (id === "spider") {
    const angs = [0.55, 1.57, 2.55];
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
      const grp = (i + (s > 0 ? 1 : 0)) % 2;
      const ph = phase * P + grp * Math.PI;
      const sw = rest ? 0 : Math.sin(ph) * 0.2;
      const lift = rest ? 0 : Math.max(0, Math.cos(ph));
      const a = s * angs[i] - s * sw;
      const ca = Math.cos(a), sa = Math.sin(a);
      const hx = ca * 0.16 * S, hy = sa * 0.16 * S;
      const kx = ca * (0.38 + lift * 0.03) * S, ky = sa * (0.38 + lift * 0.03) * S;
      const fx = ca * 0.52 * S, fy = sa * 0.52 * S;
      limb(g, [hx, hy, kx, ky], 0.065 * S, METAL.base, o);
      limb(g, [kx, ky, fx, fy], 0.045 * S, METAL.dark, o);
      joint2(g, kx, ky, 0.045 * S * (1 + lift * 0.25), lift > 0.3 ? METAL.light : pal.dark, o);
      dotAt(g, fx, fy, 0.025 * S, OUTLINE);
    }
  } else if (id === "hover") {
    const sk = new Path2D();
    roundRect(sk, -0.46 * S, -0.37 * S, 0.9 * S, 0.74 * S, 0.22 * S);
    g.fillStyle = "#202326";
    g.fill(sk);
    g.save();
    g.clip(sk);
    g.strokeStyle = "#34383c";
    g.lineWidth = 0.02 * S;
    g.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * P;
      g.moveTo(0, 0);
      g.lineTo(Math.cos(a) * S, Math.sin(a) * S);
    }
    g.stroke();
    g.restore();
    g.lineWidth = o;
    g.strokeStyle = OUTLINE;
    g.stroke(sk);
    g.save();
    g.scale(0.93, 0.92);
    g.strokeStyle = rgba(pal.accent, 0.5);
    g.lineWidth = o * 0.6;
    g.stroke(sk);
    g.restore();
    for (const s of [-1, 1]) {
      const cx = -0.4 * S, cy = s * 0.2 * S, r = 0.11 * S;
      joint2(g, cx, cy, r, METAL.dark, o);
      g.strokeStyle = METAL.light;
      g.lineWidth = 0.018 * S;
      g.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = i / 5 * P + s;
        g.moveTo(cx, cy);
        g.lineTo(cx + Math.cos(a) * r * 0.85, cy + Math.sin(a) * r * 0.85);
      }
      g.stroke();
      dotAt(g, cx, cy, r * 0.25, METAL.base);
    }
  } else if (id === "rotor") {
    if (L.quad) {
      g.strokeStyle = OUTLINE;
      g.lineWidth = 0.075 * S;
      g.beginPath();
      for (const r of L.rotors) {
        g.moveTo(0, 0);
        g.lineTo(r.x, r.y);
      }
      g.stroke();
      g.strokeStyle = METAL.base;
      g.lineWidth = 0.05 * S;
      g.stroke();
      for (const r of L.rotors) joint2(g, r.x, r.y, 0.07 * S, pal.dark, o);
    } else if (L.rotors.length === 1) {
      g.strokeStyle = METAL.dark;
      g.lineWidth = 0.035 * S;
      g.beginPath();
      for (const s of [-1, 1]) {
        g.moveTo(-0.24 * S, s * 0.22 * S);
        g.lineTo(0.26 * S, s * 0.22 * S);
      }
      g.stroke();
      g.beginPath();
      roundRect(g, -0.66 * S, -0.04 * S, 0.5 * S, 0.08 * S, 0.03 * S);
      g.fillStyle = pal.dark;
      g.fill();
      g.lineWidth = o;
      g.strokeStyle = OUTLINE;
      g.stroke();
      g.beginPath();
      roundRect(g, -0.66 * S, -0.13 * S, 0.08 * S, 0.26 * S, 0.02 * S);
      g.fillStyle = pal.body;
      g.fill();
      g.stroke();
      g.beginPath();
      g.ellipse(-0.6 * S, 0.1 * S, 0.06 * S, 0.012 * S, 0, 0, P);
      g.fillStyle = "rgba(30,30,30,0.7)";
      g.fill();
    } else {
      for (const r of L.rotors) joint2(g, r.x, r.y, 0.06 * S, METAL.dark, o);
    }
  } else if (id === "jet") {
    const wing = new Path2D();
    poly(wing, mirrorPoly([0.12, -0.05, -0.18, -0.46, -0.3, -0.48, -0.3, -0.3, -0.36, -0.05]), S);
    const gr = g.createLinearGradient(0, -0.5 * S, 0, 0.5 * S);
    gr.addColorStop(0, shade(pal.dark, 0.1));
    gr.addColorStop(0.5, pal.dark);
    gr.addColorStop(1, shade(pal.dark, -0.3));
    g.fillStyle = gr;
    g.fill(wing);
    g.lineWidth = o;
    g.strokeStyle = OUTLINE;
    g.lineJoin = "round";
    g.stroke(wing);
    line(g, [-0.18, -0.44, -0.27, -0.46, -0.18, 0.44, -0.27, 0.46], S, pal.accent, o * 1.2);
    line(g, [0, -0.12, -0.26, -0.36, 0, 0.12, -0.26, 0.36], S, "rgba(0,0,0,0.35)", o * 0.5);
    for (const n of L.nozzles) {
      g.beginPath();
      roundRect(g, n.x, n.y - n.w * 0.75, 0.36 * S, n.w * 1.5, n.w * 0.6);
      g.fillStyle = METAL.dark;
      g.fill();
      g.lineWidth = o;
      g.strokeStyle = OUTLINE;
      g.stroke();
      g.fillStyle = "rgba(255,255,255,0.15)";
      g.fillRect(n.x + 0.05 * S, n.y - n.w * 0.5, 0.25 * S, n.w * 0.25);
    }
  }
}
function drawAnchorPlate(g, L, pal, o) {
  const S = L.S;
  const p = new Path2D();
  poly(p, [0.47, -0.3, 0.47, 0.3, 0.3, 0.47, -0.3, 0.47, -0.47, 0.3, -0.47, -0.3, -0.3, -0.47, 0.3, -0.47], S);
  g.fillStyle = "#3a3f44";
  g.fill(p);
  g.save();
  g.clip(p);
  g.strokeStyle = "rgba(240,190,40,0.55)";
  g.lineWidth = 0.05 * S;
  g.beginPath();
  for (let i = -12; i < 12; i++) {
    const x = i * 0.1 * S;
    g.moveTo(x, -0.6 * S);
    g.lineTo(x + 1.2 * S, 0.6 * S);
  }
  g.stroke();
  g.beginPath();
  poly(g, [0.39, -0.25, 0.39, 0.25, 0.25, 0.39, -0.25, 0.39, -0.39, 0.25, -0.39, -0.25, -0.25, -0.39, 0.25, -0.39], S);
  g.fillStyle = "#41474d";
  g.fill();
  g.restore();
  g.lineWidth = o;
  g.strokeStyle = OUTLINE;
  g.stroke(p);
  g.strokeStyle = "rgba(0,0,0,0.45)";
  g.lineWidth = o * 0.5;
  g.beginPath();
  g.arc(0, 0, 0.3 * S, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = rgba(pal.accent, 0.5);
  g.beginPath();
  g.arc(0, 0, 0.32 * S, 0, Math.PI * 2);
  g.stroke();
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2 + Math.PI / 8;
    const x = Math.cos(a) * 0.41 * S, y = Math.sin(a) * 0.41 * S;
    dotAt(g, x, y, 0.028 * S, "#1b1e21");
    dotAt(g, x - 6e-3 * S, y - 6e-3 * S, 0.016 * S, "#9aa2aa");
  }
}
var spriteCache = /* @__PURE__ */ new Map();
var turretCache = /* @__PURE__ */ new Map();
var MAX_SPRITES = 400;
function beginSprite(px, ext) {
  const size = Math.ceil(2 * ext * px);
  const c = makeCanvas(size, size);
  const g = ctx2d(c);
  g.translate(size / 2, size / 2);
  g.scale(px, px);
  return { c, g };
}
var outlineW = (px, S) => Math.max(1.3 / px, 0.03 * Math.min(S, 2));
function unitSprites(design, team, px) {
  px = Math.max(4, Math.round(px));
  const L = layoutOf(design);
  const key = `${L.key}|${team}|${px}`;
  let s = spriteCache.get(key);
  if (s) return s;
  if (spriteCache.size > MAX_SPRITES) spriteCache.clear();
  const pal = TEAM_PAL[team];
  const o = outlineW(px, L.S);
  const ext = L.ext;
  const hull = beginSprite(px, ext);
  hullUnderlay(hull.g, L, pal, o);
  const hp = hullPath(L.shape, L.S);
  paintHull(hull.g, hp, pal, L.S, o, L.hw);
  hullDetails(hull.g, L, pal, o);
  drawPlates(hull.g, L, pal, o);
  for (const m of L.mounts) if (!m.mod) {
    dotAt(hull.g, m.x, m.y, m.d * 0.32, "rgba(0,0,0,0.45)");
    dotAt(hull.g, m.x, m.y, m.d * 0.18, "rgba(255,255,255,0.08)");
  }
  const rest = beginSprite(px, ext);
  if (L.mob.id !== "anchor") drawMobility(rest.g, L, pal, 0, true, o);
  let anchor;
  if (L.mob.id === "anchor") {
    const a = beginSprite(px, ext);
    drawAnchorPlate(a.g, L, pal, o);
    anchor = a.c;
  }
  const sh = beginSprite(px, ext);
  sh.g.setTransform(1, 0, 0, 1, 0, 0);
  sh.g.filter = `blur(${Math.max(1, px * 0.04 * L.S)}px)`;
  if (anchor) sh.g.drawImage(anchor, 0, 0);
  sh.g.drawImage(rest.c, 0, 0);
  sh.g.drawImage(hull.c, 0, 0);
  sh.g.filter = "none";
  sh.g.globalCompositeOperation = "source-in";
  sh.g.fillStyle = "#000";
  sh.g.fillRect(0, 0, sh.c.width, sh.c.height);
  s = { px, ext, hull: hull.c, mob: new Array(L.frames), rest: rest.c, shadow: sh.c, sil: /* @__PURE__ */ new Map(), anchor };
  spriteCache.set(key, s);
  return s;
}
function mobFrame(design, team, s, idx) {
  const L = layoutOf(design);
  if (L.frames <= 1 || L.mob.id === "anchor") return s.rest;
  idx = (idx % L.frames + L.frames) % L.frames;
  let c = s.mob[idx];
  if (c) return c;
  const sp = beginSprite(s.px, s.ext);
  drawMobility(sp.g, L, TEAM_PAL[team], idx / L.frames, false, outlineW(s.px, L.S));
  s.mob[idx] = sp.c;
  return sp.c;
}
function silhouette(s, color) {
  let c = s.sil.get(color);
  if (c) return c;
  c = makeCanvas(s.hull.width, s.hull.height);
  const g = ctx2d(c);
  g.drawImage(s.rest, 0, 0);
  g.drawImage(s.hull, 0, 0);
  g.globalCompositeOperation = "source-in";
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  s.sil.set(color, c);
  return c;
}
function turretSprite(m, team, d, px) {
  px = Math.max(4, Math.round(px));
  const dq = Math.round(d * 100) / 100;
  const key = `${m.id}|${team}|${dq}|${px}`;
  let c = turretCache.get(key);
  if (c) return c;
  if (turretCache.size > 1200) turretCache.clear();
  const ext = TURRET_EXT * dq;
  const sp = beginSprite(px, ext);
  sp.g.fillStyle = "rgba(0,0,0,0.35)";
  sp.g.beginPath();
  sp.g.arc(dq * 0.06, dq * 0.08, dq * 0.5, 0, Math.PI * 2);
  sp.g.fill();
  drawTurret(sp.g, m, TEAM_PAL[team], dq, Math.max(1.1 / px, dq * 0.07));
  turretCache.set(key, sp.c);
  return sp.c;
}
function wreckSprite(design, team, px) {
  const s = unitSprites(design, team, px);
  let c = s.sil.get("#wreck");
  if (c) return c;
  c = makeCanvas(s.hull.width, s.hull.height);
  const g = ctx2d(c);
  g.drawImage(s.rest, 0, 0);
  g.drawImage(s.hull, 0, 0);
  g.globalCompositeOperation = "source-atop";
  g.fillStyle = "rgba(22,19,17,0.82)";
  g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = "source-atop";
  for (let i = 0; i < 6; i++) {
    const x = Math.random() * c.width, y = Math.random() * c.height, r = c.width * (0.06 + Math.random() * 0.1);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, "rgba(0,0,0,0.7)");
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  s.sil.set("#wreck", c);
  return c;
}
var DEFAULT_DIRS = { sx: 0.6, sy: 0.8, ux: 0, uy: -1 };
function blit(g, c, x, y, ang, ext, scale = 1) {
  const cs = Math.cos(ang) * scale, sn = Math.sin(ang) * scale;
  const t = g.getTransform();
  g.transform(cs, sn, -sn, cs, x, y);
  g.drawImage(c, -ext, -ext, ext * 2, ext * 2);
  g.setTransform(t);
}
function altitudeOf(p, L) {
  if (L.air || p.flying) return 0.55 + 0.25 * L.S + Math.sin(p.time * 2.1 + (p.seed ?? 0)) * 0.05;
  if (p.leap) return p.leap * 1.4 * L.S;
  if (L.mob.id === "hover") return 0.04 + Math.sin(p.time * 3 + (p.seed ?? 0)) * 0.015;
  return 0;
}
function drawUnitShadow(g, p, px, dirs = DEFAULT_DIRS) {
  const L = layoutOf(p.design);
  const s = unitSprites(p.design, p.team, px);
  const alt = altitudeOf(p, L);
  const off = 0.07 * L.S + alt * 0.7;
  const a = (p.alpha ?? 1) * (L.air || p.flying ? 0.3 : p.leap ? 0.45 - p.leap * 0.15 : 0.5);
  g.globalAlpha = a;
  const sc = L.air || p.flying ? 0.85 : 1 - (p.leap ?? 0) * 0.15;
  blit(g, s.shadow, p.x + dirs.sx * off, p.y + dirs.sy * off, L.mob.id === "anchor" ? 0 : p.angle, s.ext, sc);
  g.globalAlpha = 1;
}
function rotorBlur(g, x, y, r, blades, t, px) {
  g.fillStyle = "rgba(210,220,230,0.07)";
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "rgba(220,230,240,0.22)";
  g.lineWidth = Math.max(1 / px, r * 0.035);
  g.beginPath();
  g.arc(x, y, r * 0.95, 0, Math.PI * 2);
  g.stroke();
  const spin = t * 31;
  g.lineCap = "round";
  for (let k = 0; k < 3; k++) {
    g.strokeStyle = k === 0 ? "rgba(25,28,32,0.75)" : `rgba(190,200,210,${0.22 - k * 0.06})`;
    g.lineWidth = Math.max(1.4 / px, r * (k === 0 ? 0.09 : 0.14));
    g.beginPath();
    for (let i = 0; i < blades; i++) {
      const a = spin - k * 0.3 + i / blades * Math.PI * 2;
      g.moveTo(x + Math.cos(a) * r * 0.12, y + Math.sin(a) * r * 0.12);
      g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    g.stroke();
  }
  g.fillStyle = "#2b3035";
  g.beginPath();
  g.arc(x, y, r * 0.13, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#b0b8c0";
  g.beginPath();
  g.arc(x - r * 0.03, y - r * 0.03, r * 0.06, 0, Math.PI * 2);
  g.fill();
}
function flame(g, x, y, ang, len, w, hot) {
  const prev = g.globalCompositeOperation;
  g.globalCompositeOperation = "lighter";
  const cs = Math.cos(ang), sn = Math.sin(ang);
  const dot = softDot(hot);
  const core = softDot("rgba(255,255,240,0.9)");
  for (let i = 0; i < 3; i++) {
    const d = i / 3 * len;
    const r = w * (1.4 - i * 0.35);
    g.drawImage(dot, x + cs * d - r, y + sn * d - r, r * 2, r * 2);
  }
  g.drawImage(core, x - w * 0.6, y - w * 0.6, w * 1.2, w * 1.2);
  g.globalCompositeOperation = prev;
}
function drawUnit(g, p, px, dirs = DEFAULT_DIRS) {
  const L = layoutOf(p.design);
  const s = unitSprites(p.design, p.team, px);
  const alt = altitudeOf(p, L);
  const lift = L.air || p.flying ? 0.12 : alt * 0.35;
  const x = p.x + dirs.ux * lift, y = p.y + dirs.uy * lift;
  const sc = 1 + (p.leap ?? 0) * 0.3 + (L.air ? 0.04 : 0);
  const pal = TEAM_PAL[p.team];
  const ang = p.angle;
  const cs = Math.cos(ang), sn = Math.sin(ang);
  let alpha = p.alpha ?? 1;
  if (p.cloak === "own") alpha *= 0.4 + 0.08 * Math.sin(p.time * 5 + (p.seed ?? 0));
  else if (p.cloak === "enemy") alpha *= 0.06 + 0.05 * Math.max(0, Math.sin(p.time * 3.3 + (p.seed ?? 0)));
  g.globalAlpha = alpha;
  if (L.mob.id === "hover") {
    const prev = g.globalCompositeOperation;
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = alpha * (0.45 + 0.1 * Math.sin(p.time * 9 + (p.seed ?? 0)));
    const r = 0.55 * L.S;
    g.drawImage(softDot(pal.glow), p.x - r, p.y - r, r * 2, r * 2);
    g.globalCompositeOperation = prev;
    g.globalAlpha = alpha;
  }
  if (s.anchor) blit(g, s.anchor, x, y, 0, s.ext, sc);
  let frame = s.rest;
  if (L.frames > 1 && p.moving !== false && p.odometer !== void 0 && (p.moving || L.mob.id === "treads" || L.mob.id === "wheels" || L.mob.id === "halftrack")) {
    const ph = p.odometer / L.cycle % 1;
    frame = mobFrame(p.design, p.team, s, Math.floor(ph * L.frames));
  }
  blit(g, frame, x, y, ang, s.ext, sc);
  if (L.mob.id === "jet") {
    const fl = 0.85 + Math.random() * 0.3;
    for (const n of L.nozzles) {
      const nx = x + (cs * (n.x - 0.02) - sn * n.y) * sc, ny = y + (sn * (n.x - 0.02) + cs * n.y) * sc;
      flame(g, nx, ny, ang + Math.PI, 0.35 * L.S * fl, n.w * 1.1, "rgba(255,150,60,0.8)");
    }
  }
  if (L.mob.id === "jumpjets" && (p.leap ?? 0) > 0.02) {
    for (const n of L.nozzles) {
      const nx = x + (cs * n.x - sn * n.y) * sc, ny = y + (sn * n.x + cs * n.y) * sc;
      flame(g, nx, ny, ang + Math.PI, 0.3 * L.S * (0.5 + (p.leap ?? 0)), n.w * 1.4, "rgba(255,170,70,0.85)");
    }
  }
  blit(g, s.hull, x, y, ang, s.ext, sc);
  for (let i = 0; i < L.mounts.length; i++) {
    const m = L.mounts[i];
    if (!m.turret || !m.mod) continue;
    const mp = p.mounts?.[i];
    const sway = Math.sin(p.time * 0.7 + i * 1.7 + (p.seed ?? 0)) * 0.25;
    const ta = mp ? mp.angle : ang + sway;
    const fl = mp ? Math.max(0, Math.min(1, mp.flash)) : 0;
    let rec = fl * fl * m.d * 0.18;
    let rot = 0;
    const sw = mp?.swing ?? 0;
    if (sw > 0 && m.mod.category === "melee") {
      const k = Math.sin(sw * Math.PI);
      const v = m.mod.visual;
      if (v === "hammer" || v === "claw" || v === "chainsaw" || v === "blade") rot = Math.sin(sw * Math.PI * 2) * 0.7;
      rec = -k * m.d * (v === "ram" || v === "drill" || v === "prod" ? 0.6 : 0.3);
    }
    const mx = x + (cs * m.x - sn * m.y) * sc - Math.cos(ta) * rec;
    const my = y + (sn * m.x + cs * m.y) * sc - Math.sin(ta) * rec;
    const ts = turretSprite(m.mod, p.team, m.d, px);
    const dis = (p.disarm ?? 0) > 0;
    if (dis) g.globalAlpha = alpha * (0.55 + 0.45 * (Math.sin(p.time * 37 + i * 2) > 0 ? 1 : 0.3));
    blit(g, ts, mx, my, ta + rot, TURRET_EXT * Math.round(m.d * 100) / 100, sc);
    g.globalAlpha = alpha;
    if (m.mod.visual === "saw" || m.mod.visual === "drill") {
      const ml = muzzleLen(m.mod) * m.d * (m.mod.visual === "saw" ? 0.95 : 0.7);
      const bx = mx + Math.cos(ta) * ml * sc, by = my + Math.sin(ta) * ml * sc;
      g.strokeStyle = "rgba(255,255,255,0.55)";
      g.lineWidth = Math.max(1 / px, m.d * 0.05);
      g.beginPath();
      const sp = p.time * (sw > 0 ? 40 : 12);
      const rr2 = m.d * (m.mod.visual === "saw" ? 0.36 : 0.2);
      g.arc(bx, by, rr2, sp, sp + 1.2);
      g.stroke();
    }
    if (dis) {
      g.strokeStyle = "#ffe84a";
      g.lineWidth = Math.max(1 / px, 0.02);
      g.beginPath();
      const ph = Math.floor(p.time * 15 + i * 3);
      for (let k = 0; k < 2; k++) {
        const a = ph * 2.4 + k * 3.1;
        const r0 = m.d * 0.25, r1 = m.d * 0.6;
        g.moveTo(mx + Math.cos(a) * r0, my + Math.sin(a) * r0);
        g.lineTo(mx + Math.cos(a + 0.4) * (r0 + r1) / 2, my + Math.sin(a + 0.4) * (r0 + r1) / 2);
        g.lineTo(mx + Math.cos(a - 0.1) * r1, my + Math.sin(a - 0.1) * r1);
      }
      g.stroke();
    }
    if (mp?.reloading) {
      g.strokeStyle = `rgba(255,190,80,${0.35 + 0.25 * Math.sin(p.time * 8 + i)})`;
      g.lineWidth = Math.max(1 / px, m.d * 0.06);
      g.beginPath();
      g.arc(mx, my, m.d * 0.5, p.time * 4, p.time * 4 + 2.2);
      g.stroke();
    }
    if (m.mod.visual === "tesla" || m.mod.visual === "shield") {
      const prev = g.globalCompositeOperation;
      g.globalCompositeOperation = "lighter";
      const pulse = 0.35 + 0.25 * Math.sin(p.time * (m.mod.visual === "tesla" ? 13 : 3) + i);
      g.globalAlpha = alpha * pulse;
      const r = m.d * 0.7;
      g.drawImage(softDot(m.mod.visual === "tesla" ? "#a8d8ff" : "#7fd8ff"), mx - r, my - r, r * 2, r * 2);
      g.globalAlpha = alpha;
      g.globalCompositeOperation = prev;
    }
  }
  for (const r of L.rotors) {
    const rx = x + (cs * r.x - sn * r.y) * sc, ry = y + (sn * r.x + cs * r.y) * sc;
    rotorBlur(g, rx, ry, r.r * sc, r.blades, p.time + (p.seed ?? 0) + r.x, px);
  }
  const hf = p.hitFlash ?? 0;
  if (hf > 0.02) {
    g.globalAlpha = alpha * Math.min(0.5, hf * 0.55);
    blit(g, silhouette(s, "#ffffff"), x, y, ang, s.ext, sc);
    g.globalAlpha = alpha;
  }
  if ((p.stun ?? 0) > 0) {
    g.globalAlpha = alpha * (0.12 + 0.1 * Math.sin(p.time * 40));
    blit(g, silhouette(s, "#7fc8ff"), x, y, ang, s.ext, sc);
    g.globalAlpha = alpha;
    drawSparks(g, x, y, 0.45 * L.S, p.time, px);
  }
  if ((p.slow ?? 0) > 0) {
    g.strokeStyle = `rgba(180,124,255,${0.35 + (p.slow ?? 0)})`;
    g.lineWidth = Math.max(1.5 / px, 0.05);
    g.setLineDash([0.12, 0.1]);
    g.lineDashOffset = p.time * 0.4;
    g.beginPath();
    g.arc(x, y, 0.55 * L.S, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
  }
  if ((p.burning ?? 0) > 0) {
    const prev = g.globalCompositeOperation;
    g.globalCompositeOperation = "lighter";
    for (let i = 0; i < 3 + L.S; i++) {
      const a = i * 2.4 + (p.seed ?? 0);
      const rr2 = 0.25 * L.S * (i * 0.37 % 1);
      const fx = x + Math.cos(a) * rr2, fy = y + Math.sin(a) * rr2;
      const fl = 0.5 + 0.5 * Math.sin(p.time * 15 + i * 3.1);
      const r = (0.12 + 0.1 * fl) * Math.sqrt(L.S);
      g.globalAlpha = alpha * (0.5 + 0.4 * fl);
      g.drawImage(softDot("rgba(255,120,30,1)"), fx - r, fy - r, r * 2, r * 2);
      g.drawImage(softDot("rgba(255,230,140,1)"), fx - r * 0.4, fy - r * 0.4, r * 0.8, r * 0.8);
    }
    g.globalCompositeOperation = prev;
    g.globalAlpha = alpha;
  }
  if (p.cloak) {
    g.globalAlpha = (p.cloak === "own" ? 0.25 : 0.12) * (0.6 + 0.4 * Math.sin(p.time * 7 + (p.seed ?? 0)));
    const prev = g.globalCompositeOperation;
    g.globalCompositeOperation = "lighter";
    blit(g, silhouette(s, "#9fdcff"), x + Math.sin(p.time * 9) * 0.03, y, ang, s.ext, sc * 1.02);
    g.globalCompositeOperation = prev;
  }
  g.globalAlpha = 1;
}
function drawSparks(g, x, y, r, t, px) {
  g.strokeStyle = "#d8f0ff";
  g.lineWidth = Math.max(1 / px, 0.025);
  g.beginPath();
  const n = 3;
  for (let i = 0; i < n; i++) {
    const a = Math.floor(t * 20 + i * 7) * 2.39996;
    let px0 = x + Math.cos(a) * r * 0.3, py0 = y + Math.sin(a) * r * 0.3;
    g.moveTo(px0, py0);
    for (let k = 1; k <= 3; k++) {
      const rr2 = r * (0.3 + k * 0.25);
      const aa = a + ((i * 13 + k * 7 + Math.floor(t * 20)) % 5 - 2) * 0.15;
      px0 = x + Math.cos(aa) * rr2;
      py0 = y + Math.sin(aa) * rr2;
      g.lineTo(px0, py0);
    }
  }
  g.stroke();
}
function muzzlePos(design, i, x, y, angle, aim) {
  const L = layoutOf(design);
  const m = L.mounts[i];
  if (!m) return { x, y, d: 0.3 };
  const cs = Math.cos(angle), sn = Math.sin(angle);
  const ml = muzzleLen(m.mod ?? void 0) * m.d;
  return { x: x + cs * m.x - sn * m.y + Math.cos(aim) * ml, y: y + sn * m.x + cs * m.y + Math.sin(aim) * ml, d: m.d };
}

// src/client/render/icons.ts
function palFromColor(color) {
  return {
    body: color,
    light: shade(color, 0.4),
    dark: shade(color, -0.4),
    deep: shade(color, -0.7),
    accent: shade(color, 0.65),
    glow: shade(color, 0.75),
    glowRgb: "200,230,255",
    bar: color
  };
}
function moduleCategoryColor(id) {
  const m = MODULE_BY_ID.get(id);
  return m && CATEGORY_COLOR[m.category] || "#b0b8c0";
}
var cropCache = /* @__PURE__ */ new Map();
var PX = 96;
function cropAlpha(src) {
  const g = ctx2d(src);
  const { width: w, height: h } = src;
  const data = g.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (data[row + x * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return src;
  const c = makeCanvas(x1 - x0 + 1, y1 - y0 + 1);
  ctx2d(c).drawImage(src, x0, y0, c.width, c.height, 0, 0, c.width, c.height);
  return c;
}
function sampleDesign(kind, id) {
  if (kind === "chassis") {
    const c = CHASSIS_BY_ID.get(id);
    if (!c) return null;
    return { id: "icon", name: "icon", chassis: id, mobility: "anchor", mounts: c.mounts.map(() => null) };
  }
  if (kind === "mobility") {
    const m = MOBILITY_BY_ID.get(id);
    if (!m) return null;
    const size = m.sizes.includes(1) ? 1 : m.sizes[0];
    const chassis = CHASSIS.find((c) => c.size === size && !c.traits.includes("airOnly") && c.shape === (size === 1 ? "box" : "hex")) ?? CHASSIS.find((c) => c.size === size);
    return { id: "icon", name: "icon", chassis: chassis.id, mobility: id, mounts: chassis.mounts.map(() => null) };
  }
  return null;
}
function renderPart(kind, id, pal) {
  const E = 4;
  const c = makeCanvas(E * PX, E * PX);
  const g = ctx2d(c);
  g.translate(c.width / 2, c.height / 2);
  g.scale(PX, PX);
  const o = 1.6 / PX;
  if (kind === "module") {
    const m = MODULE_BY_ID.get(id);
    if (!m) return null;
    const d = { L: 0.62, M: 0.78, H: 0.95 }[m.mount] * (0.85 + 0.3 * (m.caliber ?? 0.5));
    if (m.kind === "armor" || m.visual === "plate") {
      const L2 = { S: 1, hw: 0.3, shape: "box", mounts: [{ x: 0, y: 0, d: d * 0.9, mod: m, slot: m.mount, turret: false }] };
      g.beginPath();
      g.rect(-0.45, -0.32, 0.9, 0.64);
      g.fillStyle = pal.body;
      g.fill();
      g.lineWidth = o;
      g.strokeStyle = "#0b0d0f";
      g.stroke();
      drawPlates(g, L2, pal, o);
    } else {
      g.rotate(-Math.PI / 4);
      drawTurret(g, m, pal, d, Math.max(o, d * 0.06));
    }
    return cropAlpha(c);
  }
  const design = sampleDesign(kind, id);
  if (!design) return null;
  const L = layoutOf(design);
  g.rotate(-Math.PI / 2);
  const S = L.S;
  const sc = 1.4 / S;
  g.scale(sc, sc);
  const oo = o / sc;
  if (kind === "chassis") {
    hullUnderlay(g, L, pal, oo);
    paintHull(g, hullPath(L.shape, S), pal, S, oo, L.hw);
    hullDetails(g, L, pal, oo);
  } else {
    if (L.mob.id === "anchor") drawAnchorPlate(g, L, pal, oo);
    else drawMobility(g, L, pal, 0.15, false, oo);
    const hp = hullPath(L.shape, S);
    g.globalAlpha = 0.18;
    g.fillStyle = pal.light;
    g.fill(hp);
    g.globalAlpha = 0.6;
    g.setLineDash([0.04 * S, 0.03 * S]);
    g.strokeStyle = pal.light;
    g.lineWidth = oo;
    g.stroke(hp);
    g.setLineDash([]);
    g.globalAlpha = 1;
    for (const r of L.rotors) {
      rotorBlur(g, r.x, r.y, r.r, r.blades, 0.37, PX * sc);
      g.strokeStyle = "#c8d0d8";
      g.lineWidth = r.r * 0.1;
      g.lineCap = "round";
      g.beginPath();
      for (let i = 0; i < r.blades; i++) {
        const a = 0.4 + i / r.blades * Math.PI * 2;
        g.moveTo(r.x, r.y);
        g.lineTo(r.x + Math.cos(a) * r.r, r.y + Math.sin(a) * r.r);
      }
      g.stroke();
    }
    if (L.mob.id === "jet" || L.mob.id === "jumpjets") {
      for (const n of L.nozzles) {
        const gr = g.createRadialGradient(n.x - 0.05 * S, n.y, 0, n.x - 0.05 * S, n.y, n.w * 2.5);
        gr.addColorStop(0, "rgba(255,240,200,1)");
        gr.addColorStop(0.4, "rgba(255,140,40,0.8)");
        gr.addColorStop(1, "rgba(255,100,20,0)");
        g.fillStyle = gr;
        g.beginPath();
        g.arc(n.x - 0.05 * S, n.y, n.w * 2.5, 0, Math.PI * 2);
        g.fill();
      }
    }
    if (L.mob.id === "hover") {
      g.strokeStyle = "rgba(134,243,255,0.6)";
      g.lineWidth = 0.03 * S;
      g.beginPath();
      g.ellipse(0, 0, 0.5 * S, 0.42 * S, 0, 0, Math.PI * 2);
      g.stroke();
    }
  }
  return cropAlpha(c);
}
function canvasPixelSize(canvas) {
  const dpr = typeof devicePixelRatio === "number" ? devicePixelRatio : 1;
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  if (cw > 0 && ch > 0) {
    const w = Math.round(cw * dpr), h = Math.round(ch * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }
  return { w: canvas.width, h: canvas.height };
}
function drawPartIcon(canvas, kind, id, opts = {}) {
  let g;
  try {
    g = ctx2d(canvas);
  } catch {
    return;
  }
  const { w, h } = canvasPixelSize(canvas);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, w, h);
  const pal = opts.team !== void 0 ? TEAM_PAL[opts.team] : opts.color ? palFromColor(opts.color) : TEAM_PAL[0];
  const key = `${kind}|${id}|${opts.team ?? ""}|${opts.color ?? ""}`;
  let art = cropCache.get(key);
  if (!art) {
    const r = renderPart(kind, id, pal);
    if (!r) return;
    art = r;
    if (cropCache.size > 600) cropCache.clear();
    cropCache.set(key, art);
  }
  if (opts.backdrop && kind === "module") {
    const col = moduleCategoryColor(id);
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.min(w, h) / 2);
    gr.addColorStop(0, col + "40");
    gr.addColorStop(1, col + "00");
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  }
  const pad = (opts.pad ?? 0.08) * Math.min(w, h);
  const k = Math.min((w - pad * 2) / art.width, (h - pad * 2) / art.height);
  const dw = art.width * k, dh = art.height * k;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  g.drawImage(art, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

// src/client/render/field.ts
var GROUND_PX = 24;
var DECAL_PX = 20;
var forwardAngle = (side2) => side2 === 0 ? -Math.PI / 2 : Math.PI / 2;
var FieldView = class {
  canvas;
  viewerSide;
  /** when true, battle events produce no sound (e.g. menu background skirmish) */
  muted = false;
  g;
  dpr = 1;
  cssW = 0;
  cssH = 0;
  cam = new Camera(FIELD_W, FIELD_H);
  controls;
  /** when true a small scale bar is drawn in the bottom-left corner */
  scaleBar = true;
  detail = null;
  fx = new Fx();
  dirs;
  vignette = null;
  // battle state
  battle = null;
  lastTick = -1;
  sinceTick = 0;
  tickInterval = DT;
  prevU = /* @__PURE__ */ new Map();
  curU = /* @__PURE__ */ new Map();
  prevP = /* @__PURE__ */ new Map();
  curP = /* @__PURE__ */ new Map();
  ptrack = /* @__PURE__ */ new Map();
  units = /* @__PURE__ */ new Map();
  vis = /* @__PURE__ */ new Map();
  pending = [];
  usePush = false;
  time = 0;
  alpha = 1;
  constructor(canvas, viewerSide, opts) {
    this.canvas = canvas;
    const interactive = opts?.interactive !== false;
    this.scaleBar = interactive;
    this.controls = new CameraControls(this.cam, canvas, interactive);
    this.viewerSide = viewerSide;
    this.g = ctx2d(canvas);
    this.dirs = viewerSide === 0 ? { sx: 0.55, sy: 0.85, ux: 0, uy: -1 } : { sx: -0.55, sy: -0.85, ux: 0, uy: 1 };
    loadTextures();
    try {
      setPanFlip(viewerSide === 1);
    } catch {
    }
    this.resize();
  }
  /** call when the canvas' CSS size changes */
  resize() {
    const dpr = Math.min(3, typeof devicePixelRatio === "number" && devicePixelRatio > 0 ? devicePixelRatio : 1);
    const cw = this.canvas.clientWidth || this.canvas.width / dpr || 300;
    const ch = this.canvas.clientHeight || this.canvas.height / dpr || 400;
    this.dpr = dpr;
    this.cssW = cw;
    this.cssH = ch;
    const w = Math.max(1, Math.round(cw * dpr)), h = Math.max(1, Math.round(ch * dpr));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    this.cam.setViewport(cw, ch);
    this.vignette = null;
    this.detail = null;
    this.fx.setDecalSpace(FIELD_W, FIELD_H, DECAL_PX);
  }
  /** CSS px per cell (camera zoom) */
  get k() {
    return this.cam.k;
  }
  /** screen position (CSS px) of the visual (rotated) field's top-left corner */
  get ox() {
    return this.cssW / 2 - this.cam.cx * this.cam.k;
  }
  get oy() {
    return this.cssH / 2 - this.cam.cy * this.cam.k;
  }
  /** quantized device px per cell for sprite caches (avoids thrashing while zooming) */
  get spritePx() {
    const raw = Math.max(4, this.k * this.dpr);
    return Math.min(96, Math.round(2 ** (Math.round(Math.log2(raw) * 3) / 3)));
  }
  /* ---------------------------------------------------------------------------------------- camera API */
  toVisual(x, y) {
    return this.viewerSide === 1 ? { x: FIELD_W - x, y: FIELD_H - y } : { x, y };
  }
  /** whole field fits (minimum zoom) */
  fit(instant = false) {
    this.cam.fit(instant);
  }
  /** frame the viewer's own deploy zone plus some of no-man's land */
  frameDeploy(instant = false) {
    this.checkSize();
    const c = this.cam;
    const rows = DEPLOY_D + 6;
    let k = Math.min(c.vw / FIELD_W, c.vh / rows);
    if (c.vw < 640) k = Math.max(k, 11);
    k = Math.max(c.minK, k);
    c.setTarget(FIELD_W / 2, FIELD_H - c.vh / (2 * k) + 0.4, k, instant);
  }
  /** center on world point (x, y); zoom is relative to fit (1 = whole field, omitted = keep current) */
  focusOn(x, y, zoom, instant = false) {
    const v = this.toVisual(x, y);
    this.cam.setTarget(v.x, v.y, zoom === void 0 ? this.cam.tk : this.cam.minK * zoom, instant);
  }
  /** multiply zoom by f about a screen point (CSS px; default viewport center) */
  zoomBy(f, screenX, screenY) {
    this.cam.zoomBy(f, screenX, screenY);
  }
  /** true if the pointer gesture that just ended was a pan/pinch; clears the flag */
  consumeDrag() {
    return this.controls.consumeDrag();
  }
  get wasDrag() {
    return this.controls.wasDrag;
  }
  stepCamera(dt) {
    this.cam.update(dt);
  }
  checkSize() {
    const cw = this.canvas.clientWidth, ch = this.canvas.clientHeight;
    const dpr = Math.min(3, typeof devicePixelRatio === "number" && devicePixelRatio > 0 ? devicePixelRatio : 1);
    if (cw && cw !== this.cssW || ch && ch !== this.cssH || dpr !== this.dpr) this.resize();
  }
  /** device px per cell */
  get px() {
    return this.k * this.dpr;
  }
  worldToScreen(x, y) {
    if (this.viewerSide === 1) return { x: this.ox + (FIELD_W - x) * this.k, y: this.oy + (FIELD_H - y) * this.k };
    return { x: this.ox + x * this.k, y: this.oy + y * this.k };
  }
  /** canvas CSS px (e.g. from offsetX/offsetY) -> world cells */
  screenToWorld(px, py) {
    const wx = (px - this.ox) / this.k, wy = (py - this.oy) / this.k;
    if (this.viewerSide === 1) return { x: FIELD_W - wx, y: FIELD_H - wy };
    return { x: wx, y: wy };
  }
  /** Queue a step's events (call after EVERY battle.step()). */
  pushEvents(events) {
    this.usePush = true;
    for (const e of events) this.pending.push(e);
    if (this.pending.length > 6e3) this.pending.splice(0, this.pending.length - 6e3);
  }
  setWorld(shakeX = 0, shakeY = 0) {
    const d = this.dpr, k = this.k;
    if (this.viewerSide === 1) this.g.setTransform(-k * d, 0, 0, -k * d, (this.ox + FIELD_W * k + shakeX) * d, (this.oy + FIELD_H * k + shakeY) * d);
    else this.g.setTransform(k * d, 0, 0, k * d, (this.ox + shakeX) * d, (this.oy + shakeY) * d);
  }
  setScreen() {
    this.g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }
  teamOf(side2) {
    return side2 === this.viewerSide ? 0 : 1;
  }
  /* ----------------------------------------------------------------------------------------- ground */
  drawGround(showZone, sx, sy) {
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = "#121416";
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.setWorld(sx, sy);
    g.fillStyle = "rgba(0,0,0,0.5)";
    g.fillRect(-0.25, -0.25, FIELD_W + 0.5, FIELD_H + 0.5);
    g.drawImage(groundCanvas(GROUND_PX), 0, 0, FIELD_W, FIELD_H);
    this.drawDetail();
    if (this.fx.decalCanvas) g.drawImage(this.fx.decalCanvas, 0, 0, FIELD_W, FIELD_H);
    const myTop = this.viewerSide === 0 ? FIELD_H - DEPLOY_D : 0;
    const enTop = this.viewerSide === 0 ? 0 : FIELD_H - DEPLOY_D;
    const mine = TEAM_PAL[0], theirs = TEAM_PAL[1];
    g.fillStyle = rgba(theirs.body, 0.07);
    g.fillRect(0, enTop, FIELD_W, DEPLOY_D);
    g.fillStyle = rgba(mine.body, showZone ? 0.16 : 0.07);
    g.fillRect(0, myTop, FIELD_W, DEPLOY_D);
    const lw2 = 1 / this.k;
    if (showZone) {
      g.strokeStyle = rgba(mine.accent, 0.13);
      g.lineWidth = lw2;
      g.beginPath();
      for (let x = 1; x < FIELD_W; x++) {
        g.moveTo(x, myTop);
        g.lineTo(x, myTop + DEPLOY_D);
      }
      for (let y = 1; y < DEPLOY_D; y++) {
        g.moveTo(0, myTop + y);
        g.lineTo(FIELD_W, myTop + y);
      }
      g.stroke();
    }
    const myFront = this.viewerSide === 0 ? myTop : DEPLOY_D;
    const enFront = this.viewerSide === 0 ? DEPLOY_D : FIELD_H - DEPLOY_D;
    g.lineWidth = lw2 * (showZone ? 2 : 1.5);
    g.setLineDash([0.5, 0.3]);
    g.strokeStyle = rgba(mine.accent, showZone ? 0.75 : 0.35);
    g.beginPath();
    g.moveTo(0, myFront);
    g.lineTo(FIELD_W, myFront);
    g.stroke();
    g.strokeStyle = rgba(theirs.accent, 0.3);
    g.beginPath();
    g.moveTo(0, enFront);
    g.lineTo(FIELD_W, enFront);
    g.stroke();
    g.setLineDash([]);
    g.strokeStyle = "rgba(255,255,255,0.12)";
    g.lineWidth = lw2 * 1.5;
    g.strokeRect(0, 0, FIELD_W, FIELD_H);
  }
  /** hi-res ground patch for the visible area when zoomed in; rebuilt once the camera settles */
  drawDetail() {
    const px = this.px;
    if (px < GROUND_PX * 1.2) {
      this.detail = null;
      return;
    }
    const g = this.g;
    const a = this.screenToWorld(0, 0), b = this.screenToWorld(this.cssW, this.cssH);
    const vx0 = Math.max(0, Math.min(a.x, b.x)), vx1 = Math.min(FIELD_W, Math.max(a.x, b.x));
    const vy0 = Math.max(0, Math.min(a.y, b.y)), vy1 = Math.min(FIELD_H, Math.max(a.y, b.y));
    let d = this.detail;
    const covers = !!d && vx0 >= d.x0 - 1e-6 && vx1 <= d.x1 + 1e-6 && vy0 >= d.y0 - 1e-6 && vy1 <= d.y1 + 1e-6;
    const sharp = !!d && d.px >= px * 0.8 && d.px <= px * 1.6;
    if ((!d || !covers || !sharp) && this.cam.still > 0.12) {
      const mx = (vx1 - vx0) * 0.3, my = (vy1 - vy0) * 0.3;
      const x0 = Math.max(0, vx0 - mx), x1 = Math.min(FIELD_W, vx1 + mx);
      const y0 = Math.max(0, vy0 - my), y1 = Math.min(FIELD_H, vy1 + my);
      const dpx = Math.min(px, 3800 / (x1 - x0), 3800 / (y1 - y0));
      d = this.detail = { c: groundRegion(dpx, x0, y0, x1, y1), x0, y0, x1, y1, px: dpx };
    }
    if (d && vx0 >= d.x0 - 1e-6 && vx1 <= d.x1 + 1e-6 && vy0 >= d.y0 - 1e-6 && vy1 <= d.y1 + 1e-6) {
      g.drawImage(d.c, d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0);
    }
  }
  /** scale bar (bottom-left): a round number of metres */
  drawScaleBar() {
    if (!this.scaleBar) return;
    const g = this.g;
    this.setScreen();
    const pxPerM = this.k / METERS_PER_CELL;
    let m = 5;
    for (const c of [5, 10, 25, 50, 100, 200, 250]) {
      m = c;
      if (c * pxPerM >= 56) break;
    }
    const len = m * pxPerM;
    const x = 12, y = this.cssH - 12;
    g.save();
    g.lineCap = "butt";
    g.font = "600 11px system-ui, sans-serif";
    g.textBaseline = "bottom";
    g.fillStyle = "rgba(255,255,255,0.85)";
    g.strokeStyle = "rgba(0,0,0,0.6)";
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(x, y - 5);
    g.lineTo(x, y);
    g.lineTo(x + len, y);
    g.lineTo(x + len, y - 5);
    g.stroke();
    g.lineWidth = 2;
    g.strokeStyle = "rgba(255,255,255,0.85)";
    g.beginPath();
    g.moveTo(x, y - 5);
    g.lineTo(x, y);
    g.lineTo(x + len, y);
    g.lineTo(x + len, y - 5);
    g.stroke();
    g.lineWidth = 3;
    g.strokeStyle = "rgba(0,0,0,0.6)";
    g.strokeText(`${m} m`, x + 2, y - 4);
    g.fillText(`${m} m`, x + 2, y - 4);
    g.restore();
  }
  drawVignette() {
    const g = this.g;
    this.setScreen();
    if (!this.vignette) {
      const cx = this.cssW / 2, cy = this.cssH / 2;
      const r = Math.hypot(cx, cy);
      const gr = g.createRadialGradient(cx, cy, r * 0.45, cx, cy, r * 1.05);
      gr.addColorStop(0, "rgba(0,0,0,0)");
      gr.addColorStop(1, "rgba(0,0,0,0.45)");
      this.vignette = gr;
    }
    g.fillStyle = this.vignette;
    g.fillRect(0, 0, this.cssW, this.cssH);
  }
  /* ------------------------------------------------------------------------------------------ board */
  /** Deploy phase: static units and overlay. Call every frame (animates idle details). */
  drawBoard(units, overlay, time) {
    this.checkSize();
    const g = this.g;
    const dt = this.time ? clamp(time - this.time, 0, 0.1) : 0;
    this.time = time;
    this.fx.update(dt);
    this.stepCamera(dt);
    this.drawGround(!!overlay.showZone, 0, 0);
    const px = this.spritePx;
    const hv = overlay.hover;
    if (hv) {
      const col = hv.valid ? "#46e88a" : "#ff4a4a";
      g.fillStyle = rgba(col, 0.22 + 0.06 * Math.sin(time * 6));
      g.fillRect(hv.col, hv.row, hv.size, hv.size);
      g.strokeStyle = rgba(col, 0.9);
      g.lineWidth = 2 / this.k;
      g.strokeRect(hv.col + 0.04, hv.row + 0.04, hv.size - 0.08, hv.size - 0.08);
    }
    const poses = [];
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      const seed = hash01(i * 7919 + Math.round(u.x * 13 + u.y * 101)) * 10;
      const p = {
        design: u.design,
        team: this.teamOf(u.side),
        x: u.x,
        y: u.y,
        angle: forwardAngle(u.side),
        time,
        seed,
        alpha: u.ghost ? 0.5 : u.dim ? 0.45 : 1,
        moving: false,
        odometer: 0
      };
      poses.push({ u, p, air: layoutOf(u.design).air });
    }
    for (const pass of [false, true]) {
      for (const { u, p, air } of poses) {
        if (air !== pass) continue;
        drawUnitShadow(g, p, px, this.dirs);
        if (u.selected) {
          const S = layoutOf(u.design).S;
          g.strokeStyle = rgba(TEAM_PAL[0].accent, 0.6 + 0.3 * Math.sin(time * 5));
          g.lineWidth = 2 / this.k;
          g.beginPath();
          g.arc(u.x, u.y, S * 0.58, 0, Math.PI * 2);
          g.stroke();
        }
        drawUnit(g, p, px, this.dirs);
        if (u.invalid) {
          const s = unitSprites(u.design, p.team, px);
          g.globalAlpha = 0.55;
          const cs = Math.cos(p.angle), sn = Math.sin(p.angle);
          const tr = g.getTransform();
          g.transform(cs, sn, -sn, cs, u.x, u.y);
          g.drawImage(silhouette(s, "#ff3030"), -s.ext, -s.ext, s.ext * 2, s.ext * 2);
          g.setTransform(tr);
          g.globalAlpha = 1;
        }
      }
    }
    this.fx.draw(g, px, this.dirs.ux, this.dirs.uy);
    this.setScreen();
    for (const { u } of poses) if (u.level > 1 && !u.ghost) this.drawPips(u.x, u.y, layoutOf(u.design).S, u.level, 1);
    this.drawVignette();
    this.drawScaleBar();
  }
  drawPips(x, y, S, level, alpha) {
    const g = this.g;
    const p = this.worldToScreen(x, y);
    const half = S * this.k * 0.45;
    const sz = Math.max(3, Math.min(6, this.k * 0.18));
    const by = p.y + half + sz * 0.3;
    g.globalAlpha = alpha;
    for (let i = 0; i < level - 1; i++) {
      const cx = p.x + (i - (level - 2) / 2) * sz * 1.5;
      g.beginPath();
      g.moveTo(cx - sz * 0.6, by);
      g.lineTo(cx, by + sz * 0.55);
      g.lineTo(cx + sz * 0.6, by);
      g.lineTo(cx + sz * 0.6, by - sz * 0.4);
      g.lineTo(cx, by + sz * 0.15);
      g.lineTo(cx - sz * 0.6, by - sz * 0.4);
      g.closePath();
      g.fillStyle = "#ffd24a";
      g.fill();
      g.lineWidth = 1;
      g.strokeStyle = "rgba(0,0,0,0.7)";
      g.stroke();
    }
    g.globalAlpha = 1;
  }
  /* ----------------------------------------------------------------------------------------- battle */
  reset(b) {
    this.battle = b;
    this.lastTick = -1;
    this.prevU.clear();
    this.curU.clear();
    this.prevP.clear();
    this.curP.clear();
    this.ptrack.clear();
    this.vis.clear();
    this.fx.clear();
    this.sinceTick = 0;
  }
  snapshot(b) {
    this.prevU = this.curU;
    this.curU = /* @__PURE__ */ new Map();
    this.units.clear();
    for (const u of b.units) {
      this.units.set(u.id, u);
      if (!u.alive) continue;
      this.curU.set(u.id, { x: u.x, y: u.y, angle: u.angle, mounts: u.mounts.map((m) => m.angle), odo: u.odometer });
    }
    this.prevP = this.curP;
    this.curP = /* @__PURE__ */ new Map();
    for (const p of b.projectiles) {
      this.curP.set(p.id, { x: p.x, y: p.y, z: p.z, angle: p.angle, progress: p.progress });
      if (!this.ptrack.has(p.id)) {
        this.ptrack.set(p.id, { sx: p.x, sy: p.y, lx: p.x, ly: p.y, kind: p.kind, moduleId: p.moduleId, side: p.side, born: this.time });
      }
    }
  }
  /** Battle phase: draw the sim's current state and spawn fx/sfx for queued events. */
  drawBattle(battle, frameDt) {
    this.checkSize();
    const dt = clamp(frameDt, 0, 0.1);
    this.time += dt;
    if (battle !== this.battle || battle.tick < this.lastTick) this.reset(battle);
    let newTicks = null;
    if (battle.tick !== this.lastTick) {
      if (this.lastTick >= 0) {
        const interval = this.sinceTick / Math.max(1, battle.tick - this.lastTick);
        this.tickInterval = clamp(lerp(this.tickInterval, Math.max(interval, 1 / 240) * Math.max(1, battle.tick - this.lastTick), 0.3), 1 / 120, 0.25);
      }
      this.snapshot(battle);
      if (this.lastTick < 0) this.prevU = new Map(this.curU);
      this.handleVanished(battle);
      this.lastTick = battle.tick;
      this.sinceTick = 0;
      if (!this.usePush) newTicks = battle.events;
    } else this.sinceTick += dt;
    this.alpha = clamp(this.sinceTick / this.tickInterval, 0, 1);
    const events = newTicks ?? this.pending;
    if (events.length) {
      for (const e of events) this.handleEvent(e);
      if (!this.muted) try {
        battleSfx(events);
      } catch {
      }
      if (!newTicks) this.pending = [];
    }
    this.fx.update(dt);
    this.stepCamera(dt);
    for (const v of this.vis.values()) for (let i = 0; i < v.swing.length; i++) v.swing[i] = Math.max(0, v.swing[i] - dt * 3.5);
    const g = this.g;
    const tr = this.fx.trauma * this.fx.trauma;
    const sx = tr ? (Math.random() * 2 - 1) * tr * 7 : 0, sy = tr ? (Math.random() * 2 - 1) * tr * 7 : 0;
    this.drawGround(false, sx, sy);
    const px = this.spritePx;
    const ground = [], air = [];
    const bars = [];
    for (const u of battle.units) {
      if (!u.alive) continue;
      const p = this.poseOf(u);
      (u.flying ? air : ground).push(p);
      bars.push({ u, p });
    }
    this.drawArcMarkers(g, battle.projectiles);
    for (const p of ground) drawUnitShadow(g, p, px, this.dirs);
    for (const p of ground) drawUnit(g, p, px, this.dirs);
    this.drawShields(g, bars.filter((b) => !b.u.flying));
    this.drawProjectiles(g, battle.projectiles, false, dt);
    for (const p of air) drawUnitShadow(g, p, px, this.dirs);
    for (const p of air) drawUnit(g, p, px, this.dirs);
    this.drawShields(g, bars.filter((b) => b.u.flying));
    this.drawProjectiles(g, battle.projectiles, true, dt);
    this.fx.draw(g, px, this.dirs.ux, this.dirs.uy);
    this.setScreen();
    for (const { u, p } of bars) this.drawBar(u, p, dt);
    this.drawVignette();
    this.drawScaleBar();
  }
  visOf(u) {
    let v = this.vis.get(u.id);
    if (!v) {
      v = { shieldT: -9, hpShown: u.hp, swing: u.mounts.map(() => 0), seen: this.time };
      this.vis.set(u.id, v);
    }
    return v;
  }
  poseOf(u) {
    const a = this.alpha;
    const c = this.curU.get(u.id);
    const pr = this.prevU.get(u.id) ?? c;
    const v = this.visOf(u);
    let x = u.x, y = u.y, ang = u.angle, odo = u.odometer;
    let mounts;
    if (c && pr) {
      x = lerp(pr.x, c.x, a);
      y = lerp(pr.y, c.y, a);
      if (Math.hypot(c.x - pr.x, c.y - pr.y) > 3) {
        x = c.x;
        y = c.y;
      }
      ang = lerpAngle(pr.angle, c.angle, a);
      odo = lerp(pr.odo, c.odo, a);
      mounts = u.mounts.map((m, i) => ({
        angle: lerpAngle(pr.mounts[i] ?? m.angle, c.mounts[i] ?? m.angle, a),
        flash: m.flash,
        swing: v.swing[i] ?? 0,
        reloading: m.reloading
      }));
    } else mounts = u.mounts.map((m, i) => ({ angle: m.angle, flash: m.flash, swing: v.swing[i] ?? 0, reloading: m.reloading }));
    const ext = u;
    return {
      design: u.design,
      team: this.teamOf(u.side),
      x,
      y,
      angle: ang,
      time: this.time,
      odometer: odo,
      moving: u.moving,
      leap: u.leap,
      flying: u.flying,
      hitFlash: u.hitFlash,
      mounts,
      seed: u.id * 0.618 % 10,
      stun: u.stun,
      slow: u.slow,
      burning: u.burning,
      disarm: u.disarm,
      cloak: ext.cloaked ? u.side === this.viewerSide ? "own" : "enemy" : void 0
    };
  }
  drawShields(g, list) {
    const prev = g.globalCompositeOperation;
    g.globalCompositeOperation = "lighter";
    for (const { u, p } of list) {
      if (u.shield <= 0) continue;
      const v = this.visOf(u);
      const since = this.time - v.shieldT;
      const hit = since < 0.6 ? 1 - since / 0.6 : 0;
      const frac = u.maxShield > 0 ? u.shield / u.maxShield : 0.5;
      const a = 0.07 + 0.05 * frac + hit * 0.45;
      if (p.cloak === "enemy") continue;
      const S = layoutOf(u.design).S;
      const r = 0.62 * S;
      const lx = p.x + this.dirs.ux * (u.flying ? 0.12 : 0), ly = p.y + this.dirs.uy * (u.flying ? 0.12 : 0);
      g.globalAlpha = a;
      const hexT = tinted("hex", "#7fd8ff");
      if (hexT && hit > 0.05) {
        g.save();
        g.beginPath();
        g.arc(lx, ly, r, 0, Math.PI * 2);
        g.clip();
        g.drawImage(hexT, lx - r, ly - r, r * 2, r * 2);
        g.restore();
      }
      g.drawImage(softDot("rgba(127,216,255,0.35)", 0.6), lx - r, ly - r, r * 2, r * 2);
      g.strokeStyle = "#9fe4ff";
      g.lineWidth = Math.max(1 / this.k, 0.035);
      g.globalAlpha = Math.min(1, a * 2.2);
      g.beginPath();
      g.arc(lx, ly, r, 0, Math.PI * 2);
      g.stroke();
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = prev;
  }
  drawBar(u, p, dt) {
    const v = this.visOf(u);
    v.hpShown = v.hpShown > u.hp ? Math.max(u.hp, v.hpShown - (u.maxHp * 0.6 + (v.hpShown - u.hp) * 3) * dt) : u.hp;
    if (p.cloak === "enemy") return;
    const damaged = u.hp < u.maxHp - 0.5;
    const S = layoutOf(u.design).S;
    if (u.level > 1) this.drawPips(p.x, p.y, S, u.level, 0.9);
    if (!damaged && u.shield <= 0) return;
    const g = this.g;
    const s = this.worldToScreen(p.x, p.y);
    const lift = u.flying ? 0.12 * this.k : 0;
    const w = Math.max(14, S * this.k * 0.78);
    const h = S >= 2 ? 4 : 3;
    const x = Math.round(s.x - w / 2);
    const y = Math.round(s.y - S * this.k * 0.52 - h - 3 - lift);
    g.fillStyle = "rgba(0,0,0,0.65)";
    g.fillRect(x - 1, y - 1, w + 2, h + 2);
    const f = clamp(u.hp / u.maxHp, 0, 1), fs = clamp(v.hpShown / u.maxHp, 0, 1);
    g.fillStyle = "rgba(255,255,255,0.75)";
    g.fillRect(x, y, w * fs, h);
    const team = this.teamOf(u.side);
    g.fillStyle = f < 0.3 ? team === 0 ? "#ffd24a" : "#ff3a2a" : TEAM_PAL[team].bar;
    g.fillRect(x, y, w * f, h);
    if (u.maxShield > 0 && u.shield > 0) {
      g.fillStyle = "#8fe0ff";
      g.fillRect(x, y - 2, w * clamp(u.shield / u.maxShield, 0, 1), 1.5);
    }
  }
  /* ------------------------------------------------------------------------------------ projectiles */
  projPos(p) {
    const c = this.curP.get(p.id);
    const pr = this.prevP.get(p.id);
    if (!c) return p;
    if (!pr) return c;
    const a = this.alpha;
    return { x: lerp(pr.x, c.x, a), y: lerp(pr.y, c.y, a), z: lerp(pr.z, c.z, a), angle: lerpAngle(pr.angle, c.angle, a), progress: lerp(pr.progress, c.progress, a) };
  }
  /** Projectiles that disappeared since the last tick without a nearby hit/explosion: ground impact puff. */
  handleVanished(b) {
    if (!this.prevP.size) return;
    const evs = this.usePush ? this.pending : b.events;
    for (const [id, last] of this.prevP) {
      if (this.curP.has(id)) continue;
      const t = this.ptrack.get(id);
      this.ptrack.delete(id);
      if (!t) continue;
      if (t.kind !== "bullet" && t.kind !== "shell" && t.kind !== "rocket") continue;
      const x = last.x, y = last.y;
      let near = false;
      for (const e of evs) {
        if ((e.t === "hit" || e.t === "explode") && Math.abs(e.x - x) < 1.6 && Math.abs(e.y - y) < 1.6) {
          near = true;
          break;
        }
      }
      if (near) continue;
      if (x < 0 || y < 0 || x > FIELD_W || y > FIELD_H) continue;
      this.fx.dust(x, y, t.kind === "shell" ? 0.3 : 0.15, t.kind === "shell" ? 4 : 2, 0.6);
      this.fx.sparks(x, y, 3, "#ffd890", 2.5, void 0, Math.PI, 0.18);
      if (t.kind !== "bullet") this.fx.decal("scorch", x, y, 0.2);
    }
  }
  drawArcMarkers(g, list) {
    for (const p of list) {
      if (p.kind !== "arc") continue;
      const t = this.ptrack.get(p.id);
      if (!t) continue;
      const pos = this.projPos(p);
      const h = pos.z;
      const r = 0.12 + 0.06 * h;
      g.globalAlpha = clamp(0.5 - h * 0.05, 0.15, 0.5);
      g.drawImage(softDot("rgba(0,0,0,0.9)", 0.3), pos.x + this.dirs.sx * h * 0.3 - r, pos.y + this.dirs.sy * h * 0.3 - r, r * 2, r * 2);
      g.globalAlpha = 1;
      const pr = pos.progress;
      if (pr < 0.04) continue;
      const lx = t.sx + (pos.x - t.sx) / pr, ly = t.sy + (pos.y - t.sy) / pr;
      const mod = modOf(p.moduleId);
      const rad = Math.max(0.5, mod?.splash ?? 1);
      const enemy = p.side !== this.viewerSide;
      const col = enemy ? "#ff5a3a" : "#5ae8d0";
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 10 + p.id);
      g.globalAlpha = (enemy ? 0.45 : 0.22) * (0.4 + 0.6 * pr);
      g.fillStyle = rgba(col, 0.18 + 0.12 * pr);
      g.beginPath();
      g.arc(lx, ly, rad * (1.05 - pr * 0.05), 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = (enemy ? 0.9 : 0.45) * (0.5 + 0.5 * pulse);
      g.strokeStyle = col;
      g.lineWidth = Math.max(1.2 / this.k, 0.04);
      g.beginPath();
      g.arc(lx, ly, rad * pr, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([0.2, 0.15]);
      g.beginPath();
      g.arc(lx, ly, rad, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 1;
    }
  }
  drawProjectiles(g, list, elevated, dt) {
    const prevOp = g.globalCompositeOperation;
    const minW = 1 / this.px;
    for (const p of list) {
      const kind = p.kind;
      const isHigh = kind === "arc" || kind === "missile";
      if (isHigh !== elevated) continue;
      const pos = this.projPos(p);
      const t = this.ptrack.get(p.id);
      const mod = modOf(p.moduleId);
      const vis = mod?.visual;
      const cal2 = mod?.caliber ?? 0.5;
      const cs = Math.cos(pos.angle), sn = Math.sin(pos.angle);
      const lift = kind === "missile" ? Math.min(0.6, pos.z * 0.4) : kind === "arc" ? pos.z * 0.45 : 0;
      const x = pos.x + this.dirs.ux * lift, y = pos.y + this.dirs.uy * lift;
      const glowC = mod ? moduleGlow(mod, TEAM_PAL[this.teamOf(p.side)]) : "#ffd27a";
      g.globalCompositeOperation = "lighter";
      switch (kind) {
        case "bullet": {
          const sniper = vis === "sniper";
          const big = mod ? (mod.mount === "M" ? 1.4 : mod.mount === "H" ? 1.8 : 1) * (0.6 + cal2) : 1;
          const len = sniper ? 0.9 : 0.22 + 0.2 * big;
          const w = sniper ? 0.05 : 0.025 + 0.022 * big;
          const col = sniper ? "#ff5050" : mod?.category === "autocannon" ? "#ffb050" : "#ffe27a";
          g.strokeStyle = col;
          g.globalAlpha = 0.5;
          g.lineWidth = Math.max(minW * 2, w * 2.2);
          g.lineCap = "round";
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x - cs * len, y - sn * len);
          g.stroke();
          g.globalAlpha = 1;
          g.strokeStyle = "#fff8e0";
          g.lineWidth = Math.max(minW, w * 0.8);
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x - cs * len * 0.6, y - sn * len * 0.6);
          g.stroke();
          break;
        }
        case "shell": {
          if (vis === "gauss") {
            g.strokeStyle = "#9fe8ff";
            g.globalAlpha = 0.45;
            g.lineWidth = Math.max(minW * 3, 0.14);
            g.beginPath();
            g.moveTo(x, y);
            g.lineTo(x - cs * 1.6, y - sn * 1.6);
            g.stroke();
            g.globalAlpha = 1;
            g.strokeStyle = "#ffffff";
            g.lineWidth = Math.max(minW, 0.05);
            g.beginPath();
            g.moveTo(x, y);
            g.lineTo(x - cs * 0.9, y - sn * 0.9);
            g.stroke();
            if (t && Math.random() < dt * 30) this.fx.ring(x, y, 0.05, 0.4, "#40ffc0", 0.3, 0.5);
          } else if (vis === "flak") {
            const blink = Math.sin(this.time * 40 + p.id) > 0 ? 1 : 0.5;
            g.globalAlpha = blink;
            g.drawImage(softDot("#ffd080", 0.3), x - 0.12, y - 0.12, 0.24, 0.24);
          } else {
            const r = 0.07 + 0.08 * cal2 * (mod?.mount === "H" ? 1.3 : 1);
            g.drawImage(softDot("rgba(255,170,80,0.8)"), x - r * 3, y - r * 3, r * 6, r * 6);
            g.strokeStyle = "#ffe8c0";
            g.lineWidth = Math.max(minW, r * 1.1);
            g.lineCap = "round";
            g.beginPath();
            g.moveTo(x, y);
            g.lineTo(x - cs * r * 3, y - sn * r * 3);
            g.stroke();
          }
          break;
        }
        case "rocket": {
          const incend = mod?.id === "incendiary";
          g.globalCompositeOperation = prevOp;
          g.strokeStyle = "#d8d4c8";
          g.lineWidth = Math.max(minW * 1.5, 0.06);
          g.lineCap = "round";
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x - cs * 0.22, y - sn * 0.22);
          g.stroke();
          g.globalCompositeOperation = "lighter";
          const fl = 0.1 + Math.random() * 0.05;
          g.drawImage(softDot(incend ? "rgba(255,120,30,0.9)" : "rgba(255,90,40,0.9)"), x - cs * 0.25 - fl, y - sn * 0.25 - fl, fl * 2, fl * 2);
          this.trail(p.id, pos.x, pos.y, 0.12, "#3a342e", 0.06);
          break;
        }
        case "missile": {
          const cruise = vis === "cruise";
          const sz = cruise ? 0.5 : mod?.id === "swarm" ? 0.16 : 0.26;
          g.globalCompositeOperation = prevOp;
          g.globalAlpha = 0.3;
          g.drawImage(softDot("rgba(0,0,0,0.9)", 0.3), pos.x + this.dirs.sx * lift - sz * 0.5, pos.y + this.dirs.sy * lift - sz * 0.5, sz, sz);
          g.globalAlpha = 1;
          g.strokeStyle = "#eeeae0";
          g.lineWidth = Math.max(minW * 1.5, sz * 0.28);
          g.lineCap = "round";
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x - cs * sz, y - sn * sz);
          g.stroke();
          g.strokeStyle = cruise ? "#c0392b" : "#ff6a3a";
          g.lineWidth = Math.max(minW, sz * 0.2);
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x - cs * sz * 0.2, y - sn * sz * 0.2);
          g.stroke();
          g.globalCompositeOperation = "lighter";
          const fr = sz * (0.4 + Math.random() * 0.2);
          const col = mod?.targetsAir && !mod.targetsGround ? "rgba(120,170,255,0.9)" : "rgba(255,220,120,0.9)";
          g.drawImage(softDot(col), x - cs * sz * 1.1 - fr, y - sn * sz * 1.1 - fr, fr * 2, fr * 2);
          this.trail(p.id, x - cs * sz, y - sn * sz, cruise ? 0.3 : 0.14, "#8a8680", cruise ? 0.04 : 0.05);
          break;
        }
        case "flame": {
          const napalm = mod?.id === "napalm";
          const prog = clamp(pos.progress, 0, 1);
          const r = (0.15 + prog * 0.45) * (napalm ? 1.3 : 1);
          g.globalAlpha = 0.85 * (1 - prog * 0.5);
          const img = tex("fireball") ?? softDot("rgba(255,130,40,0.9)");
          const rot = p.id * 1.7 + this.time * 3;
          const tr = g.getTransform();
          g.transform(Math.cos(rot), Math.sin(rot), -Math.sin(rot), Math.cos(rot), x, y);
          g.drawImage(img, -r, -r, r * 2, r * 2);
          g.setTransform(tr);
          g.globalAlpha = 0.6 * (1 - prog);
          g.drawImage(softDot("rgba(255,240,180,1)"), x - r * 0.4, y - r * 0.4, r * 0.8, r * 0.8);
          if (Math.random() < dt * 8 && this.fx.busy < 0.5) this.fx.smoke(x, y, r * 0.5, 0.8, "#2a2420", 0, 0, 0.3);
          break;
        }
        case "arc": {
          const sc = 1 + pos.z * 0.12;
          const r = (0.09 + 0.07 * cal2) * sc;
          g.globalCompositeOperation = prevOp;
          g.fillStyle = "#2a2a28";
          g.beginPath();
          g.arc(x, y, r, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = "#9a9a90";
          g.beginPath();
          g.arc(x - r * 0.3, y - r * 0.3, r * 0.4, 0, Math.PI * 2);
          g.fill();
          g.globalCompositeOperation = "lighter";
          g.globalAlpha = 0.6;
          g.drawImage(softDot("rgba(255,180,90,0.7)"), x - r * 2, y - r * 2, r * 4, r * 4);
          this.trail(p.id, x, y, 0.08 * sc, "#5a554e", 0.08);
          break;
        }
        case "orb": {
          if (vis === "sonic") {
            const r = 0.25 + clamp(pos.progress, 0, 1) * 0.5;
            const ring = tinted("shockwave", "#5ec8ff");
            g.globalAlpha = 0.85;
            if (ring) g.drawImage(ring, x - r, y - r, r * 2, r * 2);
            else {
              g.strokeStyle = "#5ec8ff";
              g.lineWidth = 0.05;
              g.beginPath();
              g.arc(x, y, r, pos.angle - 0.9, pos.angle + 0.9);
              g.stroke();
            }
          } else if (vis === "emp") {
            const r = 0.3;
            const img = tex("eball");
            const rot = this.time * 9 + p.id;
            if (img) {
              const tr = g.getTransform();
              g.transform(Math.cos(rot), Math.sin(rot), -Math.sin(rot), Math.cos(rot), x, y);
              g.drawImage(img, -r, -r, r * 2, r * 2);
              g.setTransform(tr);
            } else g.drawImage(softDot("#7ab8ff", 0.3), x - r, y - r, r * 2, r * 2);
            if (Math.random() < dt * 20) this.fx.sparks(x, y, 1, "#cfe9ff", 2, void 0, Math.PI, 0.12);
          } else {
            const r = 0.18 + 0.12 * cal2;
            g.drawImage(softDot(rgba(glowC.length === 7 ? glowC : "#e070ff", 0.6)), x - r * 2.5, y - r * 2.5, r * 5, r * 5);
            g.drawImage(softDot("#ffffff", 0.4), x - r * 0.6, y - r * 0.6, r * 1.2, r * 1.2);
            this.trail(p.id, x, y, r * 0.8, "#e070ff", 0.05, true);
          }
          break;
        }
        default: {
          g.drawImage(softDot("#ffe0a0", 0.3), x - 0.08, y - 0.08, 0.16, 0.16);
        }
      }
      g.globalAlpha = 1;
    }
    g.globalCompositeOperation = prevOp;
  }
  /** Emit trail particles along a projectile's path since it was last drawn. */
  trail(id, x, y, r, color, spacing, glow = false) {
    const t = this.ptrack.get(id);
    if (!t) return;
    const dx = x - t.lx, dy = y - t.ly;
    const d = Math.hypot(dx, dy);
    if (d > 4) {
      t.lx = x;
      t.ly = y;
      return;
    }
    const sp = spacing * (this.fx.busy > 0.6 ? 2.5 : 1);
    const n = Math.floor(d / sp);
    for (let i = 1; i <= n; i++) {
      const f = i * sp / d;
      const px = t.lx + dx * f, py = t.ly + dy * f;
      if (glow) this.fx.glow(px, py, r, color, 0.25, 0.5);
      else this.fx.smoke(px, py, r, 0.9, color, 0, 0, 0.35);
    }
    if (n > 0) {
      t.lx += dx * n * sp / d;
      t.ly += dy * n * sp / d;
    }
  }
  /* ----------------------------------------------------------------------------------------- events */
  unitRender(id) {
    const u = this.units.get(id);
    if (!u) return null;
    const c = this.curU.get(id), pr = this.prevU.get(id) ?? c;
    if (c && pr) return { u, x: lerp(pr.x, c.x, this.alpha), y: lerp(pr.y, c.y, this.alpha), angle: lerpAngle(pr.angle, c.angle, this.alpha) };
    return { u, x: u.x, y: u.y, angle: u.angle };
  }
  handleEvent(e) {
    const fx = this.fx;
    switch (e.t) {
      case "fire": {
        const mod = modOf(e.moduleId);
        const vis = mod?.visual;
        const ur = this.unitRender(e.unit);
        let mx = e.x, my = e.y, d = 0.3;
        if (ur) {
          const m = muzzlePos(ur.u.design, e.mount, ur.x, ur.y, ur.angle, e.angle);
          mx = m.x;
          my = m.y;
          d = m.d;
          if (ur.u.flying) {
            mx += this.dirs.ux * 0.12;
            my += this.dirs.uy * 0.12;
          }
          const v = this.visOf(ur.u);
          if (mod?.category === "melee") v.swing[e.mount] = 1;
        }
        const cs = Math.cos(e.angle), sn = Math.sin(e.angle);
        const cal2 = mod?.caliber ?? 0.5;
        const glowC = moduleGlow(mod, TEAM_PAL[ur ? this.teamOf(ur.u.side) : 0]);
        switch (vis) {
          case "gun":
          case "gatling":
          case "shotgun":
          case "sniper":
          case "flak":
          case "cannon":
          case "artillery":
          case "gauss": {
            const heavy = vis === "cannon" || vis === "artillery" || vis === "gauss";
            const r = d * (0.6 + cal2 * 0.8) * (heavy ? 1.5 : 1) * (vis === "shotgun" ? 1.4 : 1);
            fx.star(mx + cs * r * 0.3, my + sn * r * 0.3, r, vis === "gauss" ? "#9fe8ff" : "#ffd890", e.angle, heavy ? 0.1 : 0.06);
            fx.glow(mx, my, r * 1.3, vis === "gauss" ? "#9fe8ff" : "#ffb060", heavy ? 0.14 : 0.07, 0.8);
            if (heavy || vis === "shotgun") {
              fx.sparks(mx, my, heavy ? 6 : 4, "#ffd890", 5, e.angle, 0.35, 0.18);
              for (let i = 0; i < (heavy ? 3 : 1); i++) fx.smoke(mx + cs * 0.15, my + sn * 0.15, r * 0.5, 1, "#4a4640", cs * 1.2, sn * 1.2, 0.45);
              if (heavy && mod?.mount === "H") fx.shake(0.12);
              if (heavy) fx.dust(mx - cs * d, my - sn * d, d * 0.8, 2, 0.5);
            } else if (fx.busy < 0.4 && Math.random() < 0.25) fx.debris(mx - cs * d, my - sn * d, 1, "#d8b040", 1.5, 0.02);
            break;
          }
          case "rocketPod":
          case "missileRack":
          case "cruise": {
            const big = vis === "cruise";
            fx.glow(mx, my, big ? 0.8 : 0.35, "#ffa050", 0.12);
            for (let i = 0; i < (big ? 6 : 2); i++) fx.smoke(mx - cs * d * 0.8, my - sn * d * 0.8, big ? 0.35 : 0.18, big ? 1.8 : 1, "#6a6660", -cs * 1.5 + (Math.random() - 0.5), -sn * 1.5 + (Math.random() - 0.5), 0.5);
            if (big) {
              fx.dust(mx, my, 0.8, 5);
              fx.shake(0.1);
            }
            break;
          }
          case "mortar": {
            fx.glow(mx, my, 0.35, "#ffb060", 0.1);
            fx.ring(mx, my, 0.05, 0.5, "#ffe0b0", 0.2, 0.5);
            for (let i = 0; i < 3; i++) fx.smoke(mx, my, 0.18, 1.2, "#6a6660", 0, 0, 0.5);
            break;
          }
          case "sonic":
            fx.ring(mx + cs * 0.2, my + sn * 0.2, 0.1, 0.9, "#5ec8ff", 0.25, 0.9);
            break;
          case "flamer":
            fx.glow(mx, my, 0.18, "#ff9030", 0.08, 0.7);
            break;
          case "repair":
          case "pointdef":
            fx.glow(mx, my, 0.12, glowC, 0.08, 0.7);
            break;
          case "saw":
          case "chainsaw":
          case "hammer":
          case "claw":
          case "blade":
          case "drill":
          case "prod":
          case "ram":
            fx.sparks(mx, my, vis === "hammer" ? 10 : 6, vis === "blade" ? glowC : vis === "prod" ? "#bfe4ff" : "#ffd890", 4, e.angle, 1.1, 0.25);
            if (vis === "hammer" || vis === "ram") {
              fx.dust(mx, my, 0.4, 3);
              fx.shake(vis === "hammer" ? 0.15 : 0.05);
            }
            if (vis === "prod") fx.bolt(mx, my, 0.3, "#bfe4ff", 0.15);
            break;
          default:
            fx.glow(mx, my, 0.2 + d * 0.3, glowC, 0.1, 0.8);
        }
        break;
      }
      case "beam": {
        const mod = modOf(e.moduleId);
        const vis = mod?.visual;
        const glowC = moduleGlow(mod, TEAM_PAL[this.teamOf(e.side)]);
        const pts = [e.x1, e.y1, e.x2, e.y2];
        let impact = true;
        switch (vis) {
          case "heatray":
            fx.beam("heat", pts, "#ff6a1a", 0.07, 0.14);
            break;
          case "plasma":
            fx.beam("plasma", pts, "#e070ff", 0.09, 0.17);
            break;
          case "slowbeam":
            fx.beam("slow", pts, "#b47cff", 0.05, 0.22);
            break;
          case "repair":
            fx.beam("repair", pts, "#6dff9a", 0.05, 0.25);
            impact = false;
            if (Math.random() < 0.3) fx.heal(e.x2, e.y2);
            break;
          case "emp":
            fx.beam("scramble", pts, glowC, 0.05, 0.22);
            break;
          case "gravity": {
            fx.beam("gravity", pts, "#b070ff", 0.07, 0.3);
            const dx = e.x1 - e.x2, dy = e.y1 - e.y2;
            for (let i = 0; i < 5; i++) {
              const a = Math.random() * Math.PI * 2, r = 0.5 + Math.random() * 0.4;
              fx.sparks(e.x2 + Math.cos(a) * r, e.y2 + Math.sin(a) * r, 1, "#c890ff", 2, Math.atan2(e.y2 - (e.y2 + Math.sin(a) * r), e.x2 - (e.x2 + Math.cos(a) * r)), 0.1, 0.3);
            }
            fx.sparks(e.x2, e.y2, 2, "#c890ff", 3, Math.atan2(dy, dx), 0.3, 0.3);
            impact = false;
            break;
          }
          case "rail": {
            const heavy = (mod?.caliber ?? 0.5) > 0.7;
            fx.beam("rail", pts, "#9fe8ff", heavy ? 0.1 : 0.06, heavy ? 0.5 : 0.35);
            fx.glow(e.x1, e.y1, heavy ? 0.7 : 0.45, "#9fe8ff", 0.2);
            fx.sparks(e.x2, e.y2, 10, "#cff4ff", 5, void 0, Math.PI, 0.3);
            if (heavy) fx.shake(0.18);
            break;
          }
          case "pointdef":
            fx.beam("laser", pts, "#ff6060", 0.025, 0.08);
            impact = false;
            break;
          case "sniper":
            fx.beam("sniper", pts, "#ff5050", 0.04, 0.2);
            break;
          default:
            fx.beam("laser", pts, glowC, 0.035, 0.12);
        }
        if (impact && fx.busy < 0.7) {
          fx.glow(e.x2, e.y2, 0.25, glowC, 0.1, 0.8);
          if (Math.random() < 0.6) fx.sparks(e.x2, e.y2, 3, glowC, 3, void 0, Math.PI, 0.2);
        }
        break;
      }
      case "chain": {
        const mod = modOf(e.moduleId);
        const heavy = (mod?.caliber ?? 0.5) > 0.7;
        const col = mod?.visual === "emp" ? "#cfeaff" : "#8fb8ff";
        const pts = [];
        for (const p of e.points) pts.push(p.x, p.y);
        if (pts.length >= 4) fx.beam("lightning", pts, col, heavy ? 0.05 : 0.035, heavy ? 0.24 : 0.18);
        for (let i = 2; i < pts.length; i += 2) {
          fx.glow(pts[i], pts[i + 1], heavy ? 0.5 : 0.35, col, 0.15);
          fx.sparks(pts[i], pts[i + 1], 4, "#e0f0ff", 3, void 0, Math.PI, 0.2);
        }
        if (pts.length >= 2) fx.glow(pts[0], pts[1], 0.3, col, 0.12);
        break;
      }
      case "hit": {
        const ur = this.units.get(e.unit);
        const mod = modOf(e.moduleId);
        if (!ur) {
          fx.dust(e.x, e.y, 0.2, 2, 0.6);
          fx.sparks(e.x, e.y, 3, "#ffd890", 2.5, void 0, Math.PI, 0.18);
          break;
        }
        if (e.shieldHit) {
          const v = this.visOf(ur);
          v.shieldT = this.time;
          const S = layoutOf(ur.design).S;
          if (fx.busy < 0.7) fx.hex(ur.x, ur.y, 0.62 * S, e.x, e.y);
          fx.sparks(e.x, e.y, 3, "#bfefff", 2.5, void 0, Math.PI, 0.2);
          break;
        }
        const vis = mod?.visual;
        if (vis === "flamer" || vis === "heatray" || vis === "repair") break;
        const n = clamp(Math.round(2 + Math.sqrt(e.damage) * 0.5), 2, 12);
        fx.sparks(e.x, e.y, n, "#ffe0a0", 3.5, void 0, Math.PI, 0.22);
        if (e.damage > 60) fx.glow(e.x, e.y, 0.3 + Math.min(0.5, e.damage / 400), "#ffc070", 0.1);
        break;
      }
      case "explode": {
        const mod = modOf(e.moduleId);
        const vis = mod?.visual;
        const r = e.radius;
        const air = mod ? !mod.targetsGround && !!mod.targetsAir : false;
        if (vis === "flak" || air) fx.boom(e.x, e.y, Math.max(0.4, r * 0.7), "flak", false);
        else if (vis === "emp") fx.boom(e.x, e.y, Math.max(0.4, r), "emp");
        else if (vis === "plasma") fx.boom(e.x, e.y, Math.max(0.4, r * 0.8), "plasma");
        else if (vis === "sonic") fx.boom(e.x, e.y, Math.max(0.5, r), "sonic");
        else if (vis === "pointdef") fx.boom(e.x, e.y, 0.25, "flak", false);
        else if (mod?.burn || mod?.id === "incendiary" || mod?.id === "napalm") fx.boom(e.x, e.y, Math.max(0.35, r * 0.75), "napalm");
        else if (r < 0.35) {
          fx.glow(e.x, e.y, 0.35, "#ffb060", 0.1);
          fx.sparks(e.x, e.y, 5, "#ffd890", 3, void 0, Math.PI, 0.2);
          fx.smoke(e.x, e.y, 0.15, 0.7, "#3a3430");
        } else {
          fx.boom(e.x, e.y, r * 0.8, vis === "cruise" ? "big" : "fire");
          if (r >= 1.5) fx.shake(Math.min(0.5, r * 0.15));
        }
        break;
      }
      case "heal": {
        const u = this.units.get(e.unit);
        if (u && Math.random() < 0.5) fx.heal(u.x, u.y);
        break;
      }
      case "death": {
        const u = this.units.get(e.unit);
        const S = e.size || 1;
        const team = u ? this.teamOf(u.side) : 1;
        const x = e.x, y = e.y;
        const pal = TEAM_PAL[team];
        if (e.flying) {
          fx.boom(x + this.dirs.ux * 0.3, y + this.dirs.uy * 0.3, 0.5 * S, "fire", false);
          fx.debris(x, y, 6 * S, pal.dark, 2.5, 0.07 * S);
          fx.schedule(0.35, () => {
            fx.boom(x, y, 0.6 * S, "fire");
            if (u) fx.decal("wreck", x, y, 0, wreckSprite(u.design, team, DECAL_PX), unitSprites(u.design, team, DECAL_PX).ext * 0.8, u.angle + 0.6);
          });
        } else {
          fx.boom(x, y, 0.55 + 0.45 * S, S >= 3 ? "big" : "fire");
          fx.debris(x, y, 5 + 5 * S, pal.dark, 3 + S, 0.06 * S);
          fx.debris(x, y, 3 + 2 * S, "#2a2622", 3, 0.05 * S);
          fx.embers(x, y, 6 * S, S * 0.6);
          if (u) fx.decal("wreck", x, y, 0, wreckSprite(u.design, team, DECAL_PX), unitSprites(u.design, team, DECAL_PX).ext, u.angle);
          for (let i = 0; i < S; i++) fx.schedule(0.15 + i * 0.2, () => fx.boom(x + (Math.random() - 0.5) * S * 0.6, y + (Math.random() - 0.5) * S * 0.6, 0.3 + 0.2 * S, "fire"));
          for (let i = 0; i < 4; i++) fx.schedule(0.4 + i * 0.5, () => fx.smoke(x, y, 0.3 * S, 2.5, "#1e1c1a", 0.2, -0.3, 0.45));
        }
        fx.shake(0.1 + 0.12 * S);
        break;
      }
      case "leap": {
        const u = this.units.get(e.unit);
        if (u) {
          const S = layoutOf(u.design).S;
          fx.dust(u.x, u.y, 0.4 * S, 6, 0.8);
          fx.ring(u.x, u.y, 0.2, 0.8 * S, "#d8c8a0", 0.3, 0.4);
        }
        break;
      }
      default: {
        const ev = e;
        if (ev.t === "smoke" && ev.x !== void 0 && ev.y !== void 0) {
          const r = ev.radius ?? 1.5, dur = ev.duration ?? 5;
          const n = Math.round(6 + r * 5);
          for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r * 0.8;
            fx.smoke(ev.x + Math.cos(a) * d, ev.y + Math.sin(a) * d, r * 0.45, dur, "#8a8a86", Math.cos(a) * 0.3, Math.sin(a) * 0.3, 0.7);
          }
          fx.ring(ev.x, ev.y, 0.2, r, "#c8c8c0", 0.4, 0.3);
        }
      }
    }
  }
  destroy() {
    this.controls.destroy();
    this.detail = null;
    this.fx.clear();
    this.battle = null;
    this.prevU.clear();
    this.curU.clear();
    this.units.clear();
    this.vis.clear();
    this.pending = [];
  }
};
function drawUnitPreview(canvas, design, opts) {
  let g;
  try {
    g = ctx2d(canvas);
  } catch {
    return;
  }
  const dpr = Math.min(3, typeof devicePixelRatio === "number" && devicePixelRatio > 0 ? devicePixelRatio : 1);
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  if (cw > 0 && ch > 0) {
    const w = Math.round(cw * dpr), h = Math.round(ch * dpr);
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
  }
  const W = canvas.width, H = canvas.height;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, W, H);
  let L;
  try {
    L = layoutOf(design);
  } catch {
    return;
  }
  const time = opts?.time ?? 0;
  const ext = L.S * (L.air ? 1.25 : L.mob.id === "spider" ? 1.18 : 1.1);
  const px = Math.min(W, H) / ext;
  g.setTransform(px, 0, 0, px, W / 2, H / 2);
  const team = (opts?.side ?? 0) === 1 ? 1 : 0;
  const pose = {
    design,
    team,
    x: 0,
    y: L.air ? 0.1 * L.S : 0,
    angle: opts?.angle ?? -Math.PI / 2,
    time,
    moving: L.mob.kind !== "static",
    odometer: time * Math.max(0.6, L.cycle * 1.5),
    seed: 1
  };
  const dirs = { sx: 0.45, sy: 0.75, ux: 0, uy: -1 };
  drawUnitShadow(g, pose, px, dirs);
  drawUnit(g, pose, px, dirs);
  g.setTransform(1, 0, 0, 1, 0, 0);
}

// src/shared/stats.ts
var MAX_LOAD = 1.5;
var MAX_LEVEL = 3;
var LEVEL_BONUS = 0.3;
function loadSpeedFactor(load) {
  if (load <= 1) return 1 + 0.25 * (1 - load);
  return Math.max(0.3, 1 - (load - 1) * 1.2);
}
function designModules(d) {
  const out2 = [];
  for (const id of d.mounts) {
    if (!id) continue;
    const m = MODULE_BY_ID.get(id);
    if (m) out2.push(m);
  }
  return out2;
}
function weaponDps(w) {
  if (w.kind !== "weapon" || !w.damage || !w.cooldown) return 0;
  return w.damage * (w.burst ?? 1) * (w.pellets ?? 1) / cycleTime(w);
}
function cycleTime(w) {
  const cd = w.cooldown ?? 1;
  if (!w.magazine || !w.reload) return cd;
  return (cd * (w.magazine - 1) + w.reload) / w.magazine;
}
var PARTS_WEIGHT = 0.3;
var POWER_K = 0.36;
var REF_ARMOR = [0, 5, 12];
var RANGE_EXP = 1;
var RANGE_CAP = 2.8;
function armorEfficiency(damage, ap) {
  let sum = 0;
  for (const a of REF_ARMOR) sum += Math.max(damage * 0.15, damage - a * (1 - ap)) / damage;
  return sum / REF_ARMOR.length;
}
function hitFactor(w) {
  const p = w.projectile;
  if (p === "beam" || p === "lightning" || p === "rail" || p === "melee" || p === "missile" && !w.spread) return 1;
  const spread = (w.spread ?? 0) * 0.7;
  const flight = w.projectileSpeed ? (w.range ?? 5) / w.projectileSpeed : 0;
  const target = 0.45 + 0.6 * (w.splash ?? 0);
  return target / (target + spread + 0.25 * flight) / 0.7;
}
var MODULE_CAL = {
  aamissile: 0.86,
  ac20: 1.19,
  ac40: 0.83,
  arclance: 0.51,
  atgm: 1.31,
  autocannon: 0.75,
  autoloader: 2.29,
  barrage: 0.97,
  buzzsaw: 0.35,
  cannon: 1.1,
  cannon75: 1.15,
  chainsaw: 1.04,
  claw: 1.28,
  cruise: 0.52,
  disarm: 0.37,
  dome: 0.67,
  drill: 1.44,
  empcannon: 0.29,
  flak: 1.1,
  flamer: 0.5,
  gauss: 0.68,
  gravity: 0.57,
  gyro: 0.25,
  hammer: 1.34,
  hardened: 0.31,
  heatray: 0.31,
  heavyflak: 0.78,
  hmg: 0.61,
  howitzer: 0.21,
  incendiary: 0.55,
  jammer: 0.25,
  laser: 0.84,
  lightrail: 1,
  mg: 0.76,
  minigun: 1.08,
  mirror: 0.39,
  mlrs: 0.89,
  mortar: 0.35,
  nanite: 0.25,
  napalm: 0.43,
  overclock: 0.26,
  phantom: 0.49,
  plasma: 1.53,
  plasmablade: 0.83,
  plasmaorb: 0.73,
  pointdef: 0.48,
  quad20: 1.9,
  railgun: 0.63,
  ram: 0.35,
  reactive: 0.63,
  repair: 0.38,
  repairM: 0.91,
  rocketL: 0.94,
  rockets: 0.72,
  sam: 0.62,
  selfdestruct: 0.26,
  sensor: 0.26,
  shield: 1.06,
  shieldH: 0.99,
  shieldL: 0.39,
  shockprod: 2.47,
  shotgun: 1.9,
  slowbeam: 1.55,
  smoke: 2.48,
  sniper: 1.88,
  sonic: 0.19,
  stealth: 0.38,
  stungun: 1.55,
  swarm: 0.58,
  targeting: 0.25,
  tesla: 0.44,
  turbo: 0.26,
  twin120: 1.22,
  twin30: 1.14,
  twinlaser: 1.21,
  twinmg: 1.37,
  uplink: 0.25
};
var cal = (id) => MODULE_CAL[id] ?? 1;
function weaponValue(w, rangeMult = 1) {
  const range = (w.range ?? 0) * rangeMult;
  const rangeF = Math.min(RANGE_CAP, Math.max(0.5, Math.pow(range / 5, RANGE_EXP)));
  if (w.heal) return w.heal * 1.6 * rangeF * cal(w.id);
  if (w.kind !== "weapon" || !w.damage || !w.cooldown) return 0;
  const shots = (w.burst ?? 1) * (w.pellets ?? 1);
  let v = weaponDps(w) * armorEfficiency(w.damage, w.ap ?? 0);
  v *= 1 + 0.6 * (w.splash ?? 0);
  v *= 1 + 0.45 * (w.chain ?? 0);
  if (w.pierce) v *= 1.5;
  if ((w.pellets ?? 1) > 1) v *= 0.7;
  if (w.falloff != null) v *= 0.3 + 0.7 * w.falloff;
  const cyc = cycleTime(w);
  if (w.burn) v += w.burn.dps * Math.min(1, w.burn.duration / cyc) * (1 + 0.6 * (w.splash ?? 0));
  if (w.stun) v += w.stun * shots / cyc * 22 * (1 + 0.8 * (w.splash ?? 0));
  if (w.slow) v += w.slow / cyc * 14;
  if (w.disarm) v += w.disarm / cyc * 28;
  if (w.impulse) v += Math.abs(w.impulse) / cyc * 6 * (1 + 0.6 * (w.splash ?? 0));
  v *= hitFactor(w);
  if (w.projectile === "missile") v *= 1.1;
  if (w.minRange) v *= 0.9;
  const coverage = w.targetsGround && w.targetsAir ? 1.15 : w.targetsGround ? 0.85 : 1.5 * (w.airBonus ?? 1);
  return v * coverage * rangeF * cal(w.id);
}
function computeStats(d) {
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
  const traits = [...c.traits, ...m.traits];
  let rangeMult = 1;
  if (traits.includes("rangeBoost")) rangeMult += 0.2;
  if (traits.includes("fortified")) rangeMult += 0.15;
  let spreadMult = traits.includes("stable") ? 0.5 : 1;
  let speedBonus = 0;
  let fireRate = 1;
  for (const mod of mods) {
    hp += mod.hp ?? 0;
    armor += mod.armor ?? 0;
    weight += mod.weight;
    partsCost += mod.cost;
    shield += mod.shield ?? 0;
    heal += mod.heal ?? 0;
    dps += weaponDps(mod);
    rangeMult += mod.rangeBonus ?? 0;
    if (mod.spreadMult) spreadMult *= mod.spreadMult;
    speedBonus += mod.speedBonus ?? 0;
    fireRate += mod.fireRateBonus ?? 0;
    if (mod.gyro && !traits.includes("fireOnMove")) traits.push("fireOnMove");
    if (mod.cloak && !traits.includes(mod.cloak)) traits.push(mod.cloak);
    if (mod.hardened && !traits.includes("hardened")) traits.push("hardened");
  }
  const capacity = m.capacity[size - 1] || 1;
  const load = weight / capacity;
  let range = 0;
  for (const mod of mods) if (mod.range && mod.kind === "weapon") range = Math.max(range, mod.projectile === "melee" ? mod.range : mod.range * rangeMult);
  const sizeSpeed = size === 3 ? 0.85 : size === 2 ? 0.95 : 1;
  const speed = m.kind === "static" ? 0 : m.speed * loadSpeedFactor(load) * sizeSpeed * (1 + speedBonus);
  const turn = m.turn * (load > 1 ? Math.max(0.5, 1 - (load - 1)) : 1);
  const flying = m.kind === "air";
  const isStatic = m.kind === "static";
  let offense = 0;
  for (const mod of mods) offense += weaponValue(mod, rangeMult) * (mod.spread && spreadMult < 1 ? 1 + 0.15 * (1 - spreadMult) : 1);
  if (traits.includes("repairAura")) offense += 25;
  offense *= fireRate;
  let reactiveHp = 0;
  const shieldCal = mods.reduce((a, m2) => a + (m2.shield ?? 0) * cal(m2.id), 0) / Math.max(1, shield);
  let ehpMult = 1;
  for (const mod of mods) {
    const u = cal(mod.id);
    const eh = (mult) => 1 + (mult - 1) * u;
    if (mod.reloadBonus) offense *= 1 + 0.25 * u * mod.reloadBonus * mods.filter((w) => w.magazine).length / Math.max(1, mods.filter((w) => w.kind === "weapon").length);
    if (mod.shieldAura) offense += mod.shieldAura.amount * 0.3 * u;
    if (mod.fireRateAura) offense += mod.fireRateAura.bonus * 300 * u;
    if (mod.detect) offense += 12 * u;
    if (mod.jammer) {
      offense += 15 * u;
      ehpMult *= eh(1.1);
    }
    if (mod.deathBlast) offense += mod.deathBlast.damage * 0.06 * u;
    if (mod.regen) ehpMult *= eh(1 + mod.regen * 12);
    if (mod.pointDefense) ehpMult *= eh(1.2);
    if (mod.smoke) ehpMult *= eh(1.12);
    if (mod.reactive) reactiveHp += mod.reactive * 60 * u;
    if (mod.energyResist) ehpMult *= eh(1 + mod.energyResist * 0.4);
    if (mod.hardened) ehpMult *= eh(1.08);
    if (mod.cloak === "stealth") ehpMult *= eh(1.35);
    if (mod.cloak === "phantom") ehpMult *= eh(1.5);
  }
  offense = Math.max(offense, 5);
  let ehp = (hp + 1.2 * shield * shieldCal + reactiveHp) * (1 + armor / 15) * ehpMult;
  if (traits.includes("evasive")) ehp *= 1.15;
  if (flying) ehp *= 1.2;
  const mobilityF = isStatic ? 0.85 : 1 + 0.08 * speed + (traits.includes("fireOnMove") ? 0.05 : 0) + (traits.includes("leap") ? 0.05 : 0);
  const power = Math.sqrt(offense * ehp) * mobilityF;
  const cost = Math.max(10, Math.ceil((PARTS_WEIGHT * partsCost + POWER_K * power) / 5) * 5);
  return {
    size,
    hp: Math.round(hp),
    armor,
    weight: Math.round(weight * 10) / 10,
    capacity,
    load,
    speed: Math.round(speed * 100) / 100,
    turn,
    cost,
    flying,
    isStatic,
    range: Math.round(range * 10) / 10,
    dps: Math.round(dps),
    shield,
    heal,
    traits,
    rangeMult,
    spreadMult,
    partsCost,
    offense: Math.round(offense),
    ehp: Math.round(ehp),
    power: Math.round(power)
  };
}
var levelMult = (level) => 1 + LEVEL_BONUS * (Math.max(1, Math.min(MAX_LEVEL, level)) - 1);
function validateDesign(d) {
  const errs = [];
  if (!d || typeof d !== "object") return ["Not a design"];
  if (typeof d.id !== "string" || !d.id || d.id.length > 40) errs.push("Bad id");
  if (typeof d.name !== "string" || !d.name.trim() || d.name.length > 24) errs.push("Name must be 1-24 characters");
  const pe = pairingError(d.chassis, d.mobility);
  if (pe) {
    errs.push(pe);
    return errs;
  }
  const c = CHASSIS_BY_ID.get(d.chassis);
  if (!Array.isArray(d.mounts) || d.mounts.length !== c.mounts.length) {
    errs.push("Mount count mismatch");
    return errs;
  }
  let weapons = 0;
  d.mounts.forEach((id, i) => {
    if (id == null) return;
    const mod = MODULE_BY_ID.get(id);
    if (!mod) {
      errs.push(`Unknown module ${id}`);
      return;
    }
    if (!fitsMount(c.mounts[i], mod.mount)) errs.push(`${mod.name} (${mod.mount}) doesn't fit a ${c.mounts[i]} mount`);
    if (mod.kind === "weapon" || mod.kind === "utility") weapons++;
  });
  if (weapons === 0) errs.push("Needs at least one weapon or utility module");
  if (errs.length) return errs;
  const s = computeStats(d);
  if (s.load > MAX_LOAD) errs.push(`Overloaded: ${s.weight} / ${s.capacity} weight (max ${Math.round(MAX_LOAD * 100)}%)`);
  return errs;
}
var isValidDesign = (d) => validateDesign(d).length === 0;

// src/shared/rng.ts
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = a + 1831565813 >>> 0;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function mixSeed(a, b) {
  let h = (a ^ 2654435769) >>> 0;
  h = Math.imul(h ^ b + 2246822507, 3266489909) >>> 0;
  return (h ^ h >>> 16) >>> 0;
}

// src/shared/types.ts
var CLOAK_REVEAL = 2.5;

// src/shared/sim/battle.ts
var TURRET_TURN = 6;
var AIM_TOLERANCE = 0.2;
var RETARGET_EVERY = 0.3;
var GOAL_EVERY = 0.4;
var BURST_GAP = 0.1;
var SHIELD_DELAY = 3;
var SHIELD_REGEN = 0.05;
var EVADE_CHANCE = 0.2;
var MIN_DMG_FRAC = 0.15;
var SPLASH_EDGE = 0.3;
var CHAIN_JUMP = 2.5;
var CHAIN_FALLOFF = 0.8;
var LEAP_COOLDOWN = 6;
var LEAP_TIME = 0.8;
var AURA_RANGE = 3;
var AURA_RATE = 0.012;
var AURA_EVERY = 0.5;
var HEAL_EVENT_EVERY = 0.3;
var CRUSH_EVERY = 0.3;
var CRUSH_DMG = 14;
var RANGE_KEEP = 1.08;
var STALL_CHECK_EVERY = 20;
var MAX_STUN = 4;
var MAX_SLOW = 0.6;
var SLOW_DECAY = 0.3;
var BURN_EVERY = 0.5;
var STEALTH_FIRE_REVEAL = 1.5;
var PHANTOM_FIRE_REVEAL = 3;
var SMOKE_SIGHT = 2.5;
var SMOKE_AT = 0.6;
var REGEN_DELAY = 2;
var REACTIVE_MULT = 0.25;
var CLS_EXPLOSIVE = 1;
var CLS_ENERGY = 2;
var KNOCK_RATE = 0.35;
var ENGAGE_SHARE = 0.34;
var CELL = 3;
var HCOLS = Math.ceil(FIELD_W / CELL);
var HROWS = Math.ceil(FIELD_H / CELL);
var MAX_RADIUS = 1.4;
var TAU = Math.PI * 2;
function angDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return d;
}
function turnToward(a, b, max) {
  const d = angDiff(a, b);
  if (d > max) return a + max;
  if (d < -max) return a - max;
  return b;
}
var clamp2 = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
function damageClass(def) {
  const k = def.projectile;
  if (k === "shell" || k === "rocket" || k === "missile" || k === "arc") return CLS_EXPLOSIVE;
  if (k === "orb") return def.category === "energy" ? CLS_ENERGY | CLS_EXPLOSIVE : CLS_EXPLOSIVE;
  if (k === "beam" || k === "lightning" || k === "rail" || k === "flame") return CLS_ENERGY;
  return 0;
}
var Battle = class {
  input;
  tick = 0;
  done = false;
  winner = -1;
  units = [];
  projectiles = [];
  /** events produced by the most recent step() only */
  events = [];
  rng;
  ints = [];
  projs = [];
  nextProjId = 1;
  damageDealt = [0, 0];
  auraTimer = 0;
  head = new Int32Array(HCOLS * HROWS);
  next = new Int32Array(0);
  scratch = new Int32Array(0);
  smokes = [];
  pendingBlasts = [];
  hasCloak = false;
  detectors = [];
  domes = [];
  uplinks = [];
  jammers = [];
  pds = [];
  constructor(input) {
    this.input = input;
    this.rng = makeRng(input.seed);
    const validCache = /* @__PURE__ */ new Map();
    for (const s of [0, 1]) {
      const sideIn = input.sides[s];
      const byId2 = /* @__PURE__ */ new Map();
      for (const d of sideIn.designs) if (!byId2.has(d.id)) byId2.set(d.id, d);
      for (const p of sideIn.units) {
        const d = byId2.get(p.designId);
        if (!d) continue;
        let ok = validCache.get(d);
        if (ok === void 0) {
          try {
            ok = isValidDesign(d);
          } catch {
            ok = false;
          }
          validCache.set(d, ok);
        }
        if (!ok) continue;
        this.addUnit(s, p.uid, d, p.level, p.x, p.y);
      }
    }
    const n = this.units.length;
    for (const I of this.ints) {
      if (I.cloak) this.hasCloak = true;
      if (I.detect > 0) this.detectors.push(I);
      if (I.domeAmt > 0) this.domes.push(I);
      if (I.uplinkBonus > 0) this.uplinks.push(I);
      if (I.jammer > 0) this.jammers.push(I);
      if (I.pdRange > 0) this.pds.push(I);
    }
    this.next = new Int32Array(n);
    this.scratch = new Int32Array(Math.max(16, n));
    this.rebuildHash();
  }
  addUnit(side2, uid, design, level, lx, ly) {
    const stats = computeStats(design);
    const lm = levelMult(level);
    const c = placementCenter(side2, { x: lx, y: ly }, stats.size);
    const heading = forwardY(side2) < 0 ? -Math.PI / 2 : Math.PI / 2;
    const id = this.units.length;
    const traits = stats.traits;
    const mounts = [];
    const wpns = [];
    let canHitG = false, canHitA = false, maxRange = 0, minWeaponRange = Infinity, hasWeapon = false, hasHeal = false;
    for (const mid of design.mounts) {
      const def = mid ? MODULE_BY_ID.get(mid) ?? null : null;
      mounts.push({ moduleId: mid ?? null, angle: heading, cooldown: 0, flash: 0, target: -1 });
      if (!def || def.kind === "armor" || def.kind === "utility" && !def.heal) {
        wpns.push(null);
        continue;
      }
      const isWeapon = def.kind === "weapon";
      const melee = def.projectile === "melee";
      const range = (def.range ?? 0) * (melee ? 1 : stats.rangeMult);
      const w = {
        def,
        heal: def.heal ?? 0,
        range,
        minRange: def.minRange ?? 0,
        hitG: isWeapon && !!def.targetsGround,
        hitA: isWeapon && !!def.targetsAir,
        burstLeft: 0,
        burstTimer: 0,
        retarget: id * 0.037 % RETARGET_EVERY,
        aimX: 0,
        aimY: 0,
        healAcc: 0,
        healTimer: 0,
        spread: (def.spread ?? 0) * (stats.spreadMult ?? 1),
        dps: isWeapon ? Math.max(1e-3, weaponDps(def)) : 0,
        melee,
        cls: damageClass(def)
      };
      if (isWeapon) {
        hasWeapon = true;
        canHitG ||= w.hitG;
        canHitA ||= w.hitA;
        maxRange = Math.max(maxRange, range);
        minWeaponRange = Math.min(minWeaponRange, range);
        const ms = mounts[mounts.length - 1];
        ms.cooldown = this.rng() * (def.cooldown ?? 1) * 0.5;
        if (def.magazine && def.magazine > 0) {
          ms.ammo = def.magazine;
          ms.reloading = false;
        }
      } else hasHeal = true;
      wpns.push(w);
    }
    if (!Number.isFinite(minWeaponRange)) minWeaponRange = 3;
    let cloak = null, detect = 0, domeR = 0, domeAmt = 0, regen = 0, fireRate = 1, reloadBonus = 0;
    let uplinkR = 0, uplinkBonus = 0, pdRange = 0, pdCooldown = 0, pdModule = "", jammer = 0, smokeR = 0, smokeDur = 0;
    let reactive = 0, energyResist = 0, hardened = traits.includes("hardened"), blastDmg = 0, blastR = 0, blastModule = "";
    for (const mid of design.mounts) {
      const d = mid ? MODULE_BY_ID.get(mid) : void 0;
      if (!d) continue;
      if (d.cloak && cloak !== "phantom") cloak = d.cloak;
      if (d.detect) detect = Math.max(detect, d.detect);
      if (d.shieldAura) {
        domeR = Math.max(domeR, d.shieldAura.radius);
        domeAmt = Math.max(domeAmt, d.shieldAura.amount);
      }
      regen += d.regen ?? 0;
      fireRate += d.fireRateBonus ?? 0;
      reloadBonus += d.reloadBonus ?? 0;
      if (d.fireRateAura && d.fireRateAura.bonus > uplinkBonus) {
        uplinkBonus = d.fireRateAura.bonus;
        uplinkR = d.fireRateAura.radius;
      }
      if (d.pointDefense && d.pointDefense.range > pdRange) {
        pdRange = d.pointDefense.range;
        pdCooldown = d.pointDefense.cooldown;
        pdModule = d.id;
      }
      if (d.jammer) jammer = Math.max(jammer, d.jammer);
      if (d.smoke) {
        smokeR = Math.max(smokeR, d.smoke.radius);
        smokeDur = Math.max(smokeDur, d.smoke.duration);
      }
      reactive += d.reactive ?? 0;
      energyResist += d.energyResist ?? 0;
      if (d.hardened) hardened = true;
      if (d.deathBlast) {
        blastDmg += d.deathBlast.damage;
        blastR = Math.max(blastR, d.deathBlast.radius);
        blastModule = d.id;
      }
    }
    const maxHp = stats.hp * lm;
    const u = {
      id,
      side: side2,
      uid,
      design,
      stats,
      level,
      x: c.x,
      y: c.y,
      angle: heading,
      hp: maxHp,
      maxHp,
      shield: stats.shield,
      maxShield: stats.shield,
      alive: true,
      flying: stats.flying,
      moving: false,
      odometer: 0,
      leap: 0,
      mounts,
      hitFlash: 0,
      stun: 0,
      slow: 0,
      burning: 0,
      disarm: 0,
      cloaked: cloak !== null,
      reactive,
      auraShield: 0,
      maxAuraShield: 0
    };
    this.units.push(u);
    this.ints.push({
      u,
      wpns,
      radius: stats.size * 0.45,
      mass: stats.isStatic ? 1e6 : stats.size * stats.size,
      dmgMult: lm,
      speed: stats.speed,
      turn: stats.turn,
      fireOnMove: traits.includes("fireOnMove"),
      strafe: traits.includes("strafe"),
      evasive: traits.includes("evasive"),
      canLeap: traits.includes("leap"),
      crush: traits.includes("crush"),
      aura: traits.includes("repairAura"),
      isStatic: stats.isStatic,
      hasWeapon,
      hasHeal,
      canHitG,
      canHitA,
      maxRange,
      minWeaponRange,
      goal: -1,
      goalTimer: id * 0.053 % GOAL_EVERY,
      px: c.x,
      py: c.y,
      vx: 0,
      vy: 0,
      sinceDamage: 99,
      leapCd: 1 + this.rng() * 2,
      leapT: -1,
      lx0: 0,
      ly0: 0,
      lx1: 0,
      ly1: 0,
      strafeT: 0,
      crushCd: 0,
      burnDps: 0,
      burnSide: side2,
      burnModule: "",
      burnTick: 0,
      kbx: 0,
      kby: 0,
      cloak,
      detect,
      sinceFire: 99,
      domeR,
      domeAmt,
      regen,
      fireRate,
      reloadMult: Math.max(0.2, 1 - reloadBonus),
      uplinkR,
      uplinkBonus,
      rateAura: 0,
      pdRange,
      pdCooldown,
      pdCd: 0,
      pdModule,
      jammer,
      jammed: false,
      smokeR,
      smokeDur,
      smokeUsed: false,
      smoked: false,
      energyResist: Math.min(0.8, energyResist),
      hardened,
      blastDmg: blastDmg * lm,
      blastR,
      blastModule,
      blocker: !hasWeapon && !hasHeal,
      meleeOnly: hasWeapon && wpns.every((w) => !w || w.heal > 0 || w.melee),
      avoidSide: 0,
      avoidT: 0,
      stuckT: 0
    });
  }
  /** Advance one tick (DT seconds). No-op once done. */
  step() {
    if (this.done) return;
    this.events = [];
    const ints = this.ints;
    const n = ints.length;
    for (let i = 0; i < n; i++) {
      const I = ints[i];
      const u = I.u;
      if (!u.alive) continue;
      u.hitFlash = Math.max(0, u.hitFlash - DT * 4);
      I.sinceDamage += DT;
      I.sinceFire += DT;
      if (I.sinceDamage > SHIELD_DELAY) {
        if (u.shield < u.maxShield) u.shield = Math.min(u.maxShield, u.shield + u.maxShield * SHIELD_REGEN * DT);
        if (u.auraShield < u.maxAuraShield) u.auraShield = Math.min(u.maxAuraShield, u.auraShield + u.maxAuraShield * SHIELD_REGEN * DT);
      }
      if (I.regen > 0 && I.sinceDamage > REGEN_DELAY && u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * I.regen * DT);
      if (I.leapCd > 0) I.leapCd -= DT;
      if (I.crushCd > 0) I.crushCd -= DT;
      if (u.stun > 0) u.stun = Math.max(0, u.stun - DT);
      if (u.disarm > 0) u.disarm = Math.max(0, u.disarm - DT);
      if (u.slow > 0) u.slow = Math.max(0, u.slow - SLOW_DECAY * DT);
      if (u.burning > 0) {
        I.burnTick += DT;
        if (I.burnTick >= BURN_EVERY || u.burning <= DT) {
          const dmg = I.burnDps * I.burnTick;
          I.burnTick = 0;
          this.damage(u, dmg, 1, 1, I.burnSide, I.burnModule, u.x, u.y);
        }
        u.burning = Math.max(0, u.burning - DT);
        if (!u.alive) continue;
      }
      I.px = u.x;
      I.py = u.y;
    }
    this.updateVisibility();
    for (let i = 0; i < n; i++) {
      const I = ints[i];
      if (!I.u.alive) continue;
      I.goalTimer -= DT;
      if (I.goalTimer <= 0 || I.goal < 0 || !this.units[I.goal].alive) {
        I.goalTimer = GOAL_EVERY;
        I.goal = this.findGoal(I);
      }
      this.updateWeapons(I);
    }
    for (let i = 0; i < n; i++) {
      const I = ints[i];
      if (I.u.alive) this.move(I);
    }
    this.rebuildHash();
    this.separate();
    this.auraTimer -= DT;
    if (this.auraTimer <= 0) {
      this.auraTimer = AURA_EVERY;
      for (let i = 0; i < n; i++) if (ints[i].aura && ints[i].u.alive) this.applyAura(ints[i]);
      this.supportAuras();
    }
    if (this.pds.length) this.pointDefense();
    this.updateProjectiles();
    this.flushBlasts();
    for (let i = 0; i < n; i++) {
      const I = ints[i];
      const u = I.u;
      if (!u.alive) {
        u.moving = false;
        continue;
      }
      const dx = u.x - I.px, dy = u.y - I.py;
      const d = Math.sqrt(dx * dx + dy * dy);
      I.vx = dx / DT;
      I.vy = dy / DT;
      u.moving = d > 2e-3;
      u.odometer += d;
    }
    this.tick++;
    this.checkEnd();
  }
  // ---------------------------------------------------------------- visibility + support systems
  /** Smoke clouds tick down; cloaked units are revealed by proximity, recent fire or detectors. */
  updateVisibility() {
    const units = this.units, ints = this.ints;
    if (this.smokes.length) {
      let wi = 0;
      for (const c of this.smokes) {
        c.t -= DT;
        if (c.t > 0) this.smokes[wi++] = c;
      }
      this.smokes.length = wi;
      for (let i = 0; i < ints.length; i++) {
        const u = units[i];
        let inside = false;
        if (u.alive) for (const c of this.smokes) {
          const dx = u.x - c.x, dy = u.y - c.y;
          if (dx * dx + dy * dy <= c.r * c.r) {
            inside = true;
            break;
          }
        }
        ints[i].smoked = inside;
      }
    } else {
      for (let i = 0; i < ints.length; i++) ints[i].smoked = false;
    }
    if (!this.hasCloak) return;
    for (let i = 0; i < ints.length; i++) {
      const I = ints[i];
      const u = I.u;
      if (!I.cloak || !u.alive) continue;
      let visible = I.sinceFire < (I.cloak === "phantom" ? PHANTOM_FIRE_REVEAL : STEALTH_FIRE_REVEAL);
      if (!visible) {
        for (const D of this.detectors) {
          const o = D.u;
          if (!o.alive || o.side === u.side) continue;
          const dx = o.x - u.x, dy = o.y - u.y, r = D.detect + I.radius;
          if (dx * dx + dy * dy <= r * r) {
            visible = true;
            break;
          }
        }
      }
      if (!visible && I.cloak === "stealth") {
        const cnt = this.gather(u.x, u.y, CLOAK_REVEAL + I.radius + MAX_RADIUS);
        for (let q = 0; q < cnt; q++) {
          const j = this.scratch[q];
          const o = units[j];
          if (!o.alive || o.side === u.side) continue;
          if (Math.hypot(o.x - u.x, o.y - u.y) - I.radius - ints[j].radius <= CLOAK_REVEAL) {
            visible = true;
            break;
          }
        }
      }
      u.cloaked = !visible;
    }
  }
  /** Can `shooter` see (target) `t`? Cloak and smoke. */
  visible(shooter, t) {
    if (t.cloaked) return false;
    if (this.ints[t.id].smoked) {
      const dx = t.x - shooter.x, dy = t.y - shooter.y;
      if (dx * dx + dy * dy > SMOKE_SIGHT * SMOKE_SIGHT) return false;
    }
    return true;
  }
  /** Shield domes, command uplinks and jammers (refreshed every AURA_EVERY). */
  supportAuras() {
    const units = this.units, ints = this.ints;
    const first = this.tick === 0;
    for (const I of ints) {
      I.rateAura = 0;
      I.jammed = false;
      if (this.domes.length) I.u.maxAuraShield = 0;
    }
    for (const D of this.domes) {
      const d = D.u;
      if (!d.alive) continue;
      const cnt = this.gather(d.x, d.y, D.domeR + MAX_RADIUS);
      for (let q = 0; q < cnt; q++) {
        const o = units[this.scratch[q]];
        if (!o.alive || o.side !== d.side || o === d) continue;
        if (Math.hypot(o.x - d.x, o.y - d.y) <= D.domeR) o.maxAuraShield = Math.max(o.maxAuraShield, D.domeAmt);
      }
    }
    if (this.domes.length) for (const I of ints) {
      const u = I.u;
      if (first) u.auraShield = u.maxAuraShield;
      if (u.auraShield > u.maxAuraShield) u.auraShield = u.maxAuraShield;
    }
    for (const L of this.uplinks) {
      const l = L.u;
      if (!l.alive) continue;
      const cnt = this.gather(l.x, l.y, L.uplinkR + MAX_RADIUS);
      for (let q = 0; q < cnt; q++) {
        const j = this.scratch[q];
        const o = units[j];
        if (!o.alive || o.side !== l.side || o === l) continue;
        if (Math.hypot(o.x - l.x, o.y - l.y) <= L.uplinkR) ints[j].rateAura = Math.max(ints[j].rateAura, L.uplinkBonus);
      }
    }
    for (const J of this.jammers) {
      const jm = J.u;
      if (!jm.alive) continue;
      const cnt = this.gather(jm.x, jm.y, J.jammer + MAX_RADIUS);
      for (let q = 0; q < cnt; q++) {
        const j = this.scratch[q];
        const o = units[j];
        if (!o.alive || o.side !== jm.side) continue;
        if (Math.hypot(o.x - jm.x, o.y - jm.y) <= J.jammer) ints[j].jammed = true;
      }
    }
  }
  /** Point-defense lasers shoot down one incoming explosive projectile per cooldown. */
  pointDefense() {
    for (const I of this.pds) {
      const u = I.u;
      if (!u.alive) continue;
      if (I.pdCd > 0) I.pdCd -= DT;
      if (I.pdCd > 0 || u.stun > 0 || u.disarm > 0) continue;
      let best = null, bestD = I.pdRange * I.pdRange;
      for (const p of this.projs) {
        if (p.dead || p.side === u.side) continue;
        const k = p.kind;
        if (k !== "rocket" && k !== "missile" && k !== "shell" && k !== "arc" && k !== "orb") continue;
        const dx = p.x - u.x, dy = p.y - u.y, d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      if (!best) continue;
      best.dead = true;
      I.pdCd = I.pdCooldown;
      this.events.push({ t: "beam", moduleId: I.pdModule, x1: u.x, y1: u.y, x2: best.x, y2: best.y, side: u.side });
      this.events.push({ t: "explode", x: best.x, y: best.y, radius: 0.3, moduleId: I.pdModule });
    }
  }
  flushBlasts() {
    const pb = this.pendingBlasts;
    for (let k = 0; k < pb.length; k++) {
      const I = this.ints[pb[k]];
      const u = I.u;
      this.splash(u.x, u.y, I.blastR, I.blastDmg, 0.3, 1, u.side, false, I.blastModule, -1, true);
    }
    pb.length = 0;
  }
  // ---------------------------------------------------------------- targeting
  canHit(w, t) {
    return t.flying ? w.hitA : w.hitG;
  }
  /** Movement goal: nearest enemy this unit can attack (support units: nearest armed ally). */
  findGoal(I) {
    const u = I.u;
    const units = this.units;
    let best = -1, bestD = Infinity;
    if (I.blocker) {
      let bestA = -1, bestAD = Infinity;
      for (let j = 0; j < units.length; j++) {
        const o = units[j];
        if (!o.alive || o.side === u.side || !this.visible(u, o)) continue;
        const dx = o.x - u.x, dy = o.y - u.y, d = dx * dx + dy * dy;
        if (o.flying) {
          if (d < bestAD) {
            bestAD = d;
            bestA = j;
          }
        } else if (d < bestD) {
          bestD = d;
          best = j;
        }
      }
      return best >= 0 ? best : bestA;
    }
    if (!I.hasWeapon) {
      for (let j = 0; j < units.length; j++) {
        const o = units[j];
        if (!o.alive || o.side !== u.side || o === u || !this.ints[j].hasWeapon) continue;
        const dx = o.x - u.x, dy = o.y - u.y, d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      }
      return best;
    }
    for (let j = 0; j < units.length; j++) {
      const o = units[j];
      if (!o.alive || o.side === u.side) continue;
      if (o.flying ? !I.canHitA : !I.canHitG) continue;
      if (!this.visible(u, o)) continue;
      const dx = o.x - u.x, dy = o.y - u.y, d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    return best;
  }
  inRange(u, w, t, mult) {
    const dx = t.x - u.x, dy = t.y - u.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    let edge = d - this.ints[t.id].radius;
    if (w.melee) edge -= this.ints[u.id].radius;
    if (edge > w.range * mult || d < w.minRange) return -1;
    return d;
  }
  findTarget(u, w) {
    const units = this.units;
    let best = -1, bestD = Infinity;
    for (let j = 0; j < units.length; j++) {
      const o = units[j];
      if (!o.alive || o.side === u.side || !this.canHit(w, o)) continue;
      const d = this.inRange(u, w, o, 1);
      if (d >= 0 && !this.visible(u, o)) continue;
      if (d >= 0 && d < bestD) {
        bestD = d;
        best = j;
      }
    }
    return best;
  }
  findHealTarget(u, w) {
    const units = this.units;
    let best = -1, bestR = 0.999;
    const r2 = w.range * w.range;
    for (let j = 0; j < units.length; j++) {
      const o = units[j];
      if (!o.alive || o.side !== u.side || o === u) continue;
      const ratio = o.hp / o.maxHp;
      if (ratio >= bestR) continue;
      const dx = o.x - u.x, dy = o.y - u.y;
      if (dx * dx + dy * dy > r2) continue;
      bestR = ratio;
      best = j;
    }
    return best;
  }
  updateWeapons(I) {
    const u = I.u;
    const units = this.units;
    for (let mi = 0; mi < I.wpns.length; mi++) {
      const m = u.mounts[mi];
      if (m.flash > 0) m.flash = Math.max(0, m.flash - DT * 6);
      const w = I.wpns[mi];
      if (!w) continue;
      if (u.stun > 0) continue;
      if (m.cooldown > -DT) m.cooldown -= DT * (1 - u.slow) * (I.fireRate + I.rateAura);
      if (m.reloading && m.cooldown <= 1e-9) {
        m.reloading = false;
        m.ammo = w.def.magazine;
      }
      if (w.heal > 0) {
        this.updateHeal(I, w, m);
        continue;
      }
      let curD = -1;
      if (m.target >= 0) {
        const t2 = units[m.target];
        curD = t2.alive && this.visible(u, t2) ? this.inRange(u, w, t2, RANGE_KEEP) : -1;
        if (curD < 0) {
          m.target = -1;
          w.retarget = 0;
        }
      }
      w.retarget -= DT;
      if (w.retarget <= 0) {
        w.retarget = RETARGET_EVERY;
        const cand = this.findTarget(u, w);
        if (m.target < 0) m.target = cand;
        else if (cand >= 0 && cand !== m.target) {
          const c = units[cand];
          const dc = Math.hypot(c.x - u.x, c.y - u.y);
          if (dc < curD * 0.6) m.target = cand;
        }
      }
      const t = m.target >= 0 ? units[m.target] : null;
      let want = u.angle;
      let ax = 0, ay = 0;
      if (t) {
        const p = this.aimPoint(I, w, t);
        ax = p.x;
        ay = p.y;
        want = Math.atan2(ay - u.y, ax - u.x);
      }
      m.angle = turnToward(m.angle, want, TURRET_TURN * DT);
      if (w.burstLeft > 0) {
        if (u.disarm > 0) {
          w.burstLeft = 0;
          continue;
        }
        w.burstTimer -= DT * (1 - u.slow) * (I.fireRate + I.rateAura);
        if (w.burstTimer <= 0) {
          w.burstLeft--;
          w.burstTimer = BURST_GAP;
          if (t) {
            w.aimX = ax;
            w.aimY = ay;
          }
          this.fire(I, mi, w, t, w.aimX, w.aimY);
        }
        continue;
      }
      if (t && m.cooldown <= 1e-9 && u.disarm <= 0 && Math.abs(angDiff(m.angle, want)) < AIM_TOLERANCE && I.leapT < 0) {
        w.aimX = ax;
        w.aimY = ay;
        m.cooldown = Math.max(m.cooldown, -DT) + (w.def.cooldown ?? 1);
        if (m.ammo !== void 0) {
          m.ammo--;
          if (m.ammo <= 0) {
            m.ammo = 0;
            m.reloading = true;
            m.cooldown = Math.max(m.cooldown, (w.def.reload ?? 0) * I.reloadMult);
          }
        }
        const burst = w.def.burst ?? 1;
        if (burst > 1) {
          w.burstLeft = burst - 1;
          w.burstTimer = BURST_GAP;
        }
        this.fire(I, mi, w, t, ax, ay);
      }
    }
  }
  aimScratch = { x: 0, y: 0 };
  /** Where a weapon aims: the target's current position. Unguided shots are not led, so movers dodge slow rounds. */
  aimPoint(I, w, t) {
    const p = this.aimScratch;
    p.x = t.x;
    p.y = t.y;
    void I;
    void w;
    return p;
  }
  // ---------------------------------------------------------------- firing
  fire(I, mi, w, t, ax, ay) {
    const u = I.u;
    const def = w.def;
    const m = u.mounts[mi];
    m.flash = 1;
    I.sinceFire = 0;
    const aim = Math.atan2(ay - u.y, ax - u.x);
    const mx = u.x + Math.cos(aim) * I.radius * 0.8;
    const my = u.y + Math.sin(aim) * I.radius * 0.8;
    this.events.push({ t: "fire", unit: u.id, mount: mi, moduleId: def.id, x: mx, y: my, angle: aim });
    const dist0 = Math.hypot(ax - u.x, ay - u.y);
    let raw = (def.damage ?? 0) * I.dmgMult;
    if (def.falloff != null && def.falloff !== 1 && w.range > 0) raw *= 1 + (def.falloff - 1) * Math.min(1, dist0 / w.range);
    const kind = def.projectile ?? "bullet";
    const ap = def.ap ?? 0;
    const airBonus = def.airBonus ?? 1;
    const fx = def.stun || def.slow || def.burn || def.impulse || def.disarm ? def : null;
    const lm = I.dmgMult;
    const cls = w.cls;
    if (kind === "melee") {
      if (!t || !t.alive) return;
      const hx = t.x - Math.cos(aim) * this.ints[t.id].radius * 0.7, hy = t.y - Math.sin(aim) * this.ints[t.id].radius * 0.7;
      if (def.splash && def.splash > 0) this.splash(t.x, t.y, def.splash, raw, ap, airBonus, u.side, false, def.id, t.id, false, fx, lm, cls, u.x, u.y);
      else this.damage(t, raw, ap, airBonus, u.side, def.id, hx, hy, fx, lm, u.x, u.y, cls);
      return;
    }
    if (kind === "beam") {
      if (!t || !t.alive) return;
      this.events.push({ t: "beam", moduleId: def.id, x1: mx, y1: my, x2: t.x, y2: t.y, side: u.side });
      this.damage(t, raw, ap, airBonus, u.side, def.id, t.x, t.y, fx, lm, mx, my, cls);
      return;
    }
    if (kind === "lightning") {
      if (!t || !t.alive) return;
      this.lightning(u, w, t, raw, ap, airBonus, mx, my, fx, lm);
      return;
    }
    if (kind === "rail") {
      this.rail(u, w, aim, raw, ap, airBonus, mx, my, fx, lm);
      return;
    }
    if (kind === "none") return;
    const pellets = Math.max(1, def.pellets ?? 1);
    const c = Math.cos(aim), s = Math.sin(aim);
    const err = w.spread * Math.min(1.2, dist0 / Math.max(1, w.range)) * (t && this.ints[t.id].jammed ? 2 : 1);
    const speed = def.projectileSpeed ?? 15;
    const air = kind === "arc" || kind === "flame" ? false : t ? t.flying : !w.hitG;
    for (let k = 0; k < pellets; k++) {
      let tx = ax, ty = ay;
      if (kind === "flame") {
        const a = aim + (this.rng() - 0.5) * 0.5;
        tx = mx + Math.cos(a) * w.range;
        ty = my + Math.sin(a) * w.range;
      } else if (err > 0) {
        const e1 = pellets > 1 ? ((k + 0.5) / pellets - 0.5) * 2 * err + (this.rng() - 0.5) * (err / pellets) : (this.rng() + this.rng() - 1) * err;
        const e2 = (this.rng() + this.rng() - 1) * err * 0.6;
        tx = ax - s * e1 + c * e2;
        ty = ay + c * e1 + s * e2;
      }
      const total = Math.max(0.3, Math.hypot(tx - mx, ty - my));
      const ang = Math.atan2(ty - my, tx - mx);
      const pierce = !!def.pierce;
      const p = {
        id: this.nextProjId++,
        side: u.side,
        moduleId: def.id,
        kind,
        x: mx,
        y: my,
        z: 0,
        angle: ang,
        progress: 0,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        speed,
        dmg: raw,
        ap,
        splash: def.splash ?? 0,
        airBonus,
        air,
        target: kind === "missile" && t ? t.id : -1,
        tx,
        ty,
        sx: mx,
        sy: my,
        total,
        traveled: 0,
        maxDist: kind === "flame" ? total : kind === "missile" ? w.range * 1.8 : pierce ? w.range + 1 : total + 2,
        ignore: -1,
        arcH: kind === "arc" ? 1 + total * 0.22 : 0,
        dead: false,
        pierce,
        hits: [],
        fx,
        fxMult: lm,
        cls
      };
      if (air && kind !== "missile") p.z = 1;
      else if (kind === "orb") p.z = 0.4;
      this.projs.push(p);
    }
  }
  lightning(u, w, first, raw, ap, airBonus, mx, my, fx, lm) {
    const pts = [{ x: mx, y: my }];
    const hit = [];
    let cur = first;
    let dmg = raw;
    const jumps = w.def.chain ?? 0;
    for (let k = 0; k <= jumps && cur; k++) {
      const from = pts[pts.length - 1];
      pts.push({ x: cur.x, y: cur.y });
      hit.push(cur.id);
      this.damage(cur, dmg, ap, airBonus, u.side, w.def.id, cur.x, cur.y, fx, lm, from.x, from.y, w.cls);
      dmg *= CHAIN_FALLOFF;
      if (k === jumps) break;
      let best = null, bestD = CHAIN_JUMP * CHAIN_JUMP;
      const cnt = this.gather(cur.x, cur.y, CHAIN_JUMP);
      for (let q = 0; q < cnt; q++) {
        const o = this.units[this.scratch[q]];
        if (!o.alive || o.side === u.side || !this.canHit(w, o) || hit.includes(o.id)) continue;
        const dx = o.x - cur.x, dy = o.y - cur.y, d = dx * dx + dy * dy;
        if (d < bestD || d === bestD && best && o.id < best.id) {
          bestD = d;
          best = o;
        }
      }
      cur = best;
    }
    this.events.push({ t: "chain", moduleId: w.def.id, points: pts, side: u.side });
  }
  rail(u, w, aim, raw, ap, airBonus, mx, my, fx, lm) {
    const c = Math.cos(aim), s = Math.sin(aim);
    const len = w.range;
    const ex = mx + c * len, ey = my + s * len;
    const units = this.units;
    for (let j = 0; j < units.length; j++) {
      const o = units[j];
      if (!o.alive || o.side === u.side || !this.canHit(w, o)) continue;
      const dx = o.x - mx, dy = o.y - my;
      const along = dx * c + dy * s;
      if (along < -0.3 || along > len + 0.3) continue;
      const perp = Math.abs(-dx * s + dy * c);
      if (perp <= this.ints[j].radius + 0.15) this.damage(o, raw, ap, airBonus, u.side, w.def.id, o.x, o.y, fx, lm, mx, my, w.cls);
    }
    this.events.push({ t: "beam", moduleId: w.def.id, x1: mx, y1: my, x2: clamp2(ex, -2, FIELD_W + 2), y2: clamp2(ey, -2, FIELD_H + 2), side: u.side });
  }
  updateHeal(I, w, m) {
    const u = I.u;
    w.retarget -= DT;
    let t = m.target >= 0 ? this.units[m.target] : null;
    if (t && (!t.alive || t.hp >= t.maxHp || Math.hypot(t.x - u.x, t.y - u.y) > w.range * RANGE_KEEP)) {
      t = null;
      m.target = -1;
    }
    if (w.retarget <= 0 || !t) {
      if (w.retarget <= 0) w.retarget = 0.5;
      const cand = this.findHealTarget(u, w);
      m.target = cand;
      t = cand >= 0 ? this.units[cand] : null;
    }
    if (!t) {
      m.angle = turnToward(m.angle, u.angle, TURRET_TURN * DT);
      if (w.healAcc > 0) this.flushHeal(u, w, m, null);
      return;
    }
    m.angle = turnToward(m.angle, Math.atan2(t.y - u.y, t.x - u.x), TURRET_TURN * DT);
    const amt = Math.min(w.heal * DT, t.maxHp - t.hp);
    t.hp += amt;
    w.healAcc += amt;
    m.flash = Math.max(m.flash, 0.5);
    w.healTimer -= DT;
    if (w.healTimer <= 0) this.flushHeal(u, w, m, t);
  }
  flushHeal(u, w, m, t) {
    w.healTimer = HEAL_EVENT_EVERY;
    if (w.healAcc <= 0) return;
    const target = t ?? null;
    if (target) {
      this.events.push({ t: "heal", unit: target.id, amount: w.healAcc, from: u.id });
      this.events.push({ t: "beam", moduleId: w.def.id, x1: u.x, y1: u.y, x2: target.x, y2: target.y, side: u.side });
    }
    w.healAcc = 0;
    void m;
  }
  applyAura(I) {
    const u = I.u;
    const cnt = this.gather(u.x, u.y, AURA_RANGE + MAX_RADIUS);
    for (let q = 0; q < cnt; q++) {
      const o = this.units[this.scratch[q]];
      if (!o.alive || o.side !== u.side || o === u || o.hp >= o.maxHp) continue;
      if (Math.hypot(o.x - u.x, o.y - u.y) > AURA_RANGE) continue;
      const amt = Math.min(o.maxHp * AURA_RATE * AURA_EVERY, o.maxHp - o.hp);
      o.hp += amt;
      if (amt > 0.5) this.events.push({ t: "heal", unit: o.id, amount: amt, from: u.id });
    }
  }
  // ---------------------------------------------------------------- damage
  damage(t, raw, ap, airBonus, side2, moduleId, x, y, fx = null, fxMult = 1, ox = NaN, oy = NaN, cls = 0) {
    if (!t.alive) return;
    const T = this.ints[t.id];
    if (fx && !T.hardened) {
      if (fx.disarm) t.disarm = Math.min(MAX_STUN, t.disarm + fx.disarm);
      if (fx.impulse && !t.flying && !t.stats.isStatic && !Number.isNaN(ox)) {
        const mag = fx.impulse * (t.stats.size === 1 ? 1 : t.stats.size === 2 ? 0.5 : 0.25);
        let dx = t.x - ox, dy = t.y - oy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > 1e-6) {
          dx /= d;
          dy /= d;
          const m2 = mag < 0 ? -Math.min(-mag, Math.max(0, d - 1)) : mag;
          T.kbx += dx * m2;
          T.kby += dy * m2;
        }
      }
      if (fx.stun) t.stun = Math.min(MAX_STUN, t.stun + fx.stun);
      if (fx.slow) t.slow = Math.min(MAX_SLOW, t.slow + fx.slow);
      if (fx.burn) {
        const dps = fx.burn.dps * fxMult;
        if (t.burning <= 0 || dps >= T.burnDps) {
          T.burnDps = dps;
          T.burnSide = side2;
          T.burnModule = moduleId;
        }
        t.burning = Math.max(t.burning, fx.burn.duration);
      }
    }
    if (t.flying) raw *= airBonus;
    if (cls) {
      if (cls & CLS_ENERGY && T.energyResist > 0) raw *= 1 - T.energyResist;
      if (cls & CLS_EXPLOSIVE && t.reactive > 0) {
        raw *= REACTIVE_MULT;
        t.reactive--;
      }
    }
    const effArmor = t.stats.armor * (1 - ap);
    let dmg = Math.max(raw * MIN_DMG_FRAC, raw - effArmor);
    let dealt = 0;
    let shieldHit = false;
    if (t.shield > 0) {
      const a = Math.min(t.shield, dmg);
      t.shield -= a;
      dmg -= a;
      dealt += a;
      shieldHit = true;
    }
    if (dmg > 0 && t.auraShield > 0) {
      const a = Math.min(t.auraShield, dmg);
      t.auraShield -= a;
      dmg -= a;
      dealt += a;
      shieldHit = true;
    }
    if (dmg > 0) {
      const a = Math.min(t.hp, dmg);
      t.hp -= dmg;
      dealt += a;
    }
    this.damageDealt[side2] += dealt;
    t.hitFlash = 1;
    T.sinceDamage = 0;
    this.events.push({ t: "hit", unit: t.id, damage: dealt, shieldHit, x, y, moduleId });
    if (t.hp <= 0) {
      t.hp = 0;
      t.alive = false;
      t.moving = false;
      t.leap = 0;
      t.cloaked = false;
      this.events.push({ t: "death", unit: t.id, x: t.x, y: t.y, size: t.stats.size, flying: t.flying });
      if (T.blastDmg > 0) this.pendingBlasts.push(t.id);
    } else if (T.smokeR > 0 && !T.smokeUsed && t.hp < t.maxHp * SMOKE_AT) {
      T.smokeUsed = true;
      this.smokes.push({ x: t.x, y: t.y, r: T.smokeR, t: T.smokeDur });
      this.events.push({ t: "smoke", x: t.x, y: t.y, radius: T.smokeR, duration: T.smokeDur });
    }
  }
  splash(x, y, R2, raw, ap, airBonus, side2, air, moduleId, direct, emit, fx = null, fxMult = 1, cls = 0, ox = x, oy = y) {
    if (emit) this.events.push({ t: "explode", x, y, radius: R2, moduleId });
    const cnt = this.gather(x, y, R2 + MAX_RADIUS);
    for (let q = 0; q < cnt; q++) {
      const id = this.scratch[q];
      const o = this.units[id];
      if (!o.alive || o.side === side2 || o.flying !== air) continue;
      const d = Math.hypot(o.x - x, o.y - y) - this.ints[id].radius;
      if (d > R2 && id !== direct) continue;
      const f = id === direct ? 1 : 1 - (1 - SPLASH_EDGE) * Math.max(0, d) / R2;
      this.damage(o, raw * f, ap, airBonus, side2, moduleId, o.x, o.y, fx, fxMult, ox, oy, cls);
    }
  }
  // ---------------------------------------------------------------- projectiles
  updateProjectiles() {
    const ps = this.projs;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (p.dead) continue;
      if (p.kind === "arc") {
        p.progress = Math.min(1, p.progress + p.speed * DT / p.total);
        const k = p.progress;
        p.x = p.sx + (p.tx - p.sx) * k;
        p.y = p.sy + (p.ty - p.sy) * k;
        p.z = 4 * p.arcH * k * (1 - k);
        if (k >= 1) {
          this.splash(p.tx, p.ty, p.splash, p.dmg, p.ap, p.airBonus, p.side, false, p.moduleId, -1, true, p.fx, p.fxMult, p.cls);
          p.dead = true;
        }
        continue;
      }
      if (p.kind === "missile") {
        if (p.target >= 0) {
          const t = this.units[p.target];
          if (t.alive && !this.ints[t.id].jammed) {
            p.tx = t.x;
            p.ty = t.y;
          } else p.target = -1;
        }
        const want = Math.atan2(p.ty - p.y, p.tx - p.x);
        p.angle = turnToward(p.angle, want, 5 * DT);
        p.vx = Math.cos(p.angle) * p.speed;
        p.vy = Math.sin(p.angle) * p.speed;
      }
      const ox = p.x, oy = p.y;
      const step = p.speed * DT;
      p.x += p.vx * DT;
      p.y += p.vy * DT;
      p.traveled += step;
      p.progress = Math.min(1, p.traveled / p.total);
      if (p.kind === "missile") {
        p.z = p.air ? 1 : 0.2 + 0.8 * Math.sin(Math.PI * Math.min(1, p.traveled / Math.max(1, p.total)));
      }
      const hitId = this.sweep(p, ox, oy);
      if (hitId >= 0) {
        const t = this.units[hitId];
        const T = this.ints[hitId];
        if (T.evasive && this.rng() < EVADE_CHANCE) {
          p.ignore = hitId;
        } else {
          if (p.splash > 0) this.splash(p.x, p.y, p.splash, p.dmg, p.ap, p.airBonus, p.side, p.air, p.moduleId, hitId, p.kind !== "flame", p.fx, p.fxMult, p.cls);
          else this.damage(t, p.dmg, p.ap, p.airBonus, p.side, p.moduleId, p.x, p.y, p.fx, p.fxMult, p.x - p.vx * DT, p.y - p.vy * DT, p.cls);
          if (p.pierce) {
            p.hits.push(hitId);
            p.ignore = hitId;
          } else {
            p.dead = true;
            continue;
          }
        }
      }
      if (p.kind === "missile") {
        const dx = p.tx - p.x, dy = p.ty - p.y;
        if (p.target < 0 && dx * dx + dy * dy < step * step) {
          this.splash(p.tx, p.ty, Math.max(0.4, p.splash), p.dmg, p.ap, p.airBonus, p.side, p.air, p.moduleId, -1, true, p.fx, p.fxMult, p.cls);
          p.dead = true;
          continue;
        }
      } else if (p.splash > 0 && p.kind !== "flame" && !p.pierce && p.traveled >= p.total) {
        this.splash(p.tx, p.ty, p.splash, p.dmg, p.ap, p.airBonus, p.side, p.air, p.moduleId, -1, true, p.fx, p.fxMult, p.cls);
        p.dead = true;
        continue;
      }
      if (p.traveled >= p.maxDist || p.x < -2 || p.y < -2 || p.x > FIELD_W + 2 || p.y > FIELD_H + 2) p.dead = true;
    }
    let wi = 0;
    for (let i = 0; i < ps.length; i++) if (!ps[i].dead) ps[wi++] = ps[i];
    ps.length = wi;
    this.projectiles = ps;
  }
  /** First enemy (of the projectile's layer) whose circle the segment (ox,oy)->(p.x,p.y) touches. */
  sweep(p, ox, oy) {
    const sx = p.x - ox, sy = p.y - oy;
    const len2 = sx * sx + sy * sy;
    const cx = (ox + p.x) / 2, cy = (oy + p.y) / 2;
    const cnt = this.gather(cx, cy, Math.sqrt(len2) / 2 + MAX_RADIUS);
    let best = -1, bestT = Infinity;
    for (let q = 0; q < cnt; q++) {
      const id = this.scratch[q];
      const o = this.units[id];
      if (!o.alive || o.side === p.side || o.flying !== p.air || id === p.ignore || p.pierce && p.hits.includes(id)) continue;
      const r = this.ints[id].radius;
      let t = len2 > 0 ? ((o.x - ox) * sx + (o.y - oy) * sy) / len2 : 0;
      t = clamp2(t, 0, 1);
      const qx = ox + sx * t - o.x, qy = oy + sy * t - o.y;
      if (qx * qx + qy * qy <= r * r && (t < bestT || t === bestT && id < best)) {
        bestT = t;
        best = id;
      }
    }
    return best;
  }
  // ---------------------------------------------------------------- movement
  move(I) {
    const u = I.u;
    if (I.isStatic) return;
    if (I.kbx !== 0 || I.kby !== 0) {
      const kx = I.kbx * KNOCK_RATE, ky = I.kby * KNOCK_RATE;
      u.x += kx;
      u.y += ky;
      I.kbx -= kx;
      I.kby -= ky;
      if (Math.abs(I.kbx) < 0.01 && Math.abs(I.kby) < 0.01) {
        I.kbx = 0;
        I.kby = 0;
      }
    }
    if (u.stun > 0 && I.leapT < 0 && !I.strafe) return;
    if (I.leapT >= 0) {
      I.leapT = Math.min(1, I.leapT + DT / LEAP_TIME);
      const k = I.leapT;
      u.x = I.lx0 + (I.lx1 - I.lx0) * k;
      u.y = I.ly0 + (I.ly1 - I.ly0) * k;
      u.leap = Math.sin(Math.PI * k);
      if (k >= 1) {
        I.leapT = -1;
        u.leap = 0;
      }
      return;
    }
    const goal = I.goal >= 0 ? this.units[I.goal] : null;
    if (I.strafe) {
      this.strafeMove(I, goal);
      return;
    }
    let engagedDps = 0, relevantDps = 0;
    let targetAngle = NaN;
    for (let mi = 0; mi < I.wpns.length; mi++) {
      const w = I.wpns[mi];
      if (!w || w.heal > 0) continue;
      const tg = u.mounts[mi].target;
      if (!goal || this.canHit(w, goal)) relevantDps += w.dps;
      if (tg >= 0) {
        engagedDps += w.dps;
        if (Number.isNaN(targetAngle)) targetAngle = Math.atan2(this.units[tg].y - u.y, this.units[tg].x - u.x);
      }
    }
    const engaged = engagedDps > 0 && engagedDps >= ENGAGE_SHARE * relevantDps;
    let gx = u.x, gy = u.y, wantMove = false, stopDist = 0;
    const fwd = forwardY(u.side);
    if (goal) {
      const dx2 = goal.x - u.x, dy2 = goal.y - u.y;
      const d2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
      if (I.blocker) {
        const lw2 = clamp2(1 - (d2 - 4) / 8, 0.3, 1);
        gx = u.x + dx2 * lw2;
        gy = u.y + dy2;
        stopDist = 0;
        if (d2 - I.radius - this.ints[goal.id].radius <= 0.15) return;
      } else if (!I.hasWeapon) {
        gx = goal.x;
        gy = clamp2(goal.y - fwd * (1.6 + this.ints[goal.id].radius), I.radius, FIELD_H - I.radius);
        stopDist = 0.6;
        if (d2 - I.radius - this.ints[goal.id].radius <= 1.2 && Math.abs(goal.y - fwd * 1.6 - u.y) < 2.5) return;
      } else {
        if (I.canLeap && I.leapCd <= 0 && d2 >= 3 && d2 <= 7) {
          const land = Math.max(1.5, I.minWeaponRange * 0.6);
          const jump = Math.min(5, d2 - land);
          if (jump >= 1.5) {
            I.leapT = 0;
            I.leapCd = LEAP_COOLDOWN;
            I.lx0 = u.x;
            I.ly0 = u.y;
            I.lx1 = clamp2(u.x + dx2 / d2 * jump, I.radius, FIELD_W - I.radius);
            I.ly1 = clamp2(u.y + dy2 / d2 * jump, I.radius, FIELD_H - I.radius);
            u.angle = Math.atan2(dy2, dx2);
            this.events.push({ t: "leap", unit: u.id });
            return;
          }
        }
        const engageR = I.maxRange;
        const lw2 = clamp2(1 - (d2 - engageR - 2) / 8, 0.3, 1);
        gx = u.x + dx2 * lw2;
        gy = u.y + dy2;
        stopDist = 0;
        if (engaged && (!I.fireOnMove || I.meleeOnly)) wantMove = false;
        else if (I.meleeOnly) wantMove = true;
        else if (I.fireOnMove && d2 - this.ints[goal.id].radius <= Math.max(1.2, engageR * 0.7)) wantMove = false;
        else wantMove = true;
        if (!wantMove) {
          if (!u.flying && !Number.isNaN(targetAngle)) u.angle = turnToward(u.angle, targetAngle, I.turn * DT * 0.5);
          return;
        }
      }
    } else if (I.hasWeapon && this.anyEnemyAlive(u.side)) {
      const holdY = FIELD_H / 2 - fwd * 3;
      gx = u.x;
      gy = holdY;
    } else {
      return;
    }
    const dx = gx - u.x, dy = gy - u.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= Math.max(stopDist, 0.05)) return;
    const want = Math.atan2(dy, dx) + this.avoid(I, dx / d, dy / d, goal ? goal.id : -1);
    u.angle = turnToward(u.angle, want, I.turn * DT);
    const diff = Math.abs(angDiff(u.angle, want));
    let f = diff >= Math.PI / 2 ? 0 : Math.cos(diff);
    if (u.flying) f = Math.max(f, 0.3);
    const sp = Math.min(I.speed * (1 - u.slow) * f * DT, d - stopDist * 0.5);
    if (sp <= 0) return;
    if (u.flying) {
      u.x += dx / d * sp;
      u.y += dy / d * sp;
    } else {
      u.x += Math.cos(u.angle) * sp;
      u.y += Math.sin(u.angle) * sp;
    }
  }
  /** Steering offset (radians) to slip around allies (or emplacements) that block the way ahead. */
  avoid(I, dirX, dirY, goalId) {
    const u = I.u;
    const look = I.radius + MAX_RADIUS + 0.8;
    const cnt = this.gather(u.x, u.y, look);
    let best = Infinity, bestPerp = 0, bestClear = 1;
    const mySpeed = I.speed * 0.5;
    for (let q = 0; q < cnt; q++) {
      const j = this.scratch[q];
      if (j === u.id || j === goalId) continue;
      const o = this.units[j];
      if (!o.alive || o.flying !== u.flying) continue;
      const O = this.ints[j];
      if (O.leapT >= 0) continue;
      if (o.side !== u.side && !O.isStatic) continue;
      const rx = o.x - u.x, ry = o.y - u.y;
      const along = rx * dirX + ry * dirY;
      if (along <= 0) continue;
      const clear = I.radius + O.radius + 0.1;
      if (along > clear + 0.8) continue;
      const perp = rx * -dirY + ry * dirX;
      if (Math.abs(perp) >= clear) continue;
      if (O.vx * dirX + O.vy * dirY > mySpeed) continue;
      if (along < best) {
        best = along;
        bestPerp = perp;
        bestClear = clear;
      }
    }
    if (best === Infinity) {
      if (I.avoidT > 0) I.avoidT -= DT;
      else I.avoidSide = 0;
      return 0;
    }
    if (I.avoidSide === 0) {
      I.avoidSide = bestPerp > 0.05 ? -1 : bestPerp < -0.05 ? 1 : u.id & 1 ? 1 : -1;
      const sx = u.x + I.avoidSide * -dirY * (I.radius + 1.5), sy = u.y + I.avoidSide * dirX * (I.radius + 1.5);
      if (sx < I.radius || sx > FIELD_W - I.radius || sy < I.radius || sy > FIELD_H - I.radius) I.avoidSide = -I.avoidSide;
      I.stuckT = 0;
    }
    if (I.vx * dirX + I.vy * dirY < I.speed * 0.15) {
      I.stuckT += DT;
      if (I.stuckT > 1.5) {
        I.avoidSide = -I.avoidSide;
        I.stuckT = 0;
      }
    } else I.stuckT = 0;
    I.avoidT = 0.6;
    const strength = 1 - Math.abs(bestPerp) / bestClear;
    return I.avoidSide * (0.5 + 0.9 * strength);
  }
  strafeMove(I, goal) {
    const u = I.u;
    let want;
    const margin = 1.5;
    if (u.x < margin || u.x > FIELD_W - margin || u.y < margin || u.y > FIELD_H - margin) {
      want = Math.atan2(FIELD_H / 2 - u.y, FIELD_W / 2 - u.x);
      I.strafeT = Math.max(I.strafeT, 0.2);
    } else if (I.strafeT > 0) {
      I.strafeT -= DT;
      want = u.angle;
    } else if (goal) {
      const dx = goal.x - u.x, dy = goal.y - u.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      want = Math.atan2(dy, dx);
      if (d < 1.2 || d < 2.5 && Math.abs(angDiff(u.angle, want)) > 1.2) {
        I.strafeT = 1.1;
        want = u.angle;
      }
    } else {
      want = Math.atan2(FIELD_H / 2 - u.y, FIELD_W / 2 - u.x);
    }
    if (u.stun <= 0) u.angle = turnToward(u.angle, want, I.turn * DT);
    const sp = I.speed * (1 - u.slow) * DT;
    u.x += Math.cos(u.angle) * sp;
    u.y += Math.sin(u.angle) * sp;
    u.x = clamp2(u.x, 0.5, FIELD_W - 0.5);
    u.y = clamp2(u.y, 0.5, FIELD_H - 0.5);
  }
  anyEnemyAlive(side2) {
    for (const o of this.units) if (o.alive && o.side !== side2) return true;
    return false;
  }
  // ---------------------------------------------------------------- spatial hash + separation
  rebuildHash() {
    const head = this.head;
    head.fill(-1);
    const units = this.units;
    for (let i = units.length - 1; i >= 0; i--) {
      const u = units[i];
      if (!u.alive) continue;
      const c = this.cellOf(u.x, u.y);
      this.next[i] = head[c];
      head[c] = i;
    }
  }
  cellOf(x, y) {
    const cx = clamp2(Math.floor(x / CELL), 0, HCOLS - 1);
    const cy = clamp2(Math.floor(y / CELL), 0, HROWS - 1);
    return cy * HCOLS + cx;
  }
  /** Fill this.scratch with ids of living units in hash cells overlapping the circle; returns count. */
  gather(x, y, r) {
    const x0 = clamp2(Math.floor((x - r) / CELL), 0, HCOLS - 1), x1 = clamp2(Math.floor((x + r) / CELL), 0, HCOLS - 1);
    const y0 = clamp2(Math.floor((y - r) / CELL), 0, HROWS - 1), y1 = clamp2(Math.floor((y + r) / CELL), 0, HROWS - 1);
    let n = 0;
    const sc = this.scratch;
    for (let cy = y0; cy <= y1; cy++)
      for (let cx = x0; cx <= x1; cx++)
        for (let i = this.head[cy * HCOLS + cx]; i >= 0; i = this.next[i]) sc[n++] = i;
    return n;
  }
  separate() {
    const units = this.units;
    const ints = this.ints;
    const head = this.head, next = this.next;
    for (let i = 0; i < units.length; i++) {
      const a = units[i];
      if (!a.alive) continue;
      const A2 = ints[i];
      if (A2.leapT >= 0) continue;
      const ccx = clamp2(Math.floor(a.x / CELL), 0, HCOLS - 1), ccy = clamp2(Math.floor(a.y / CELL), 0, HROWS - 1);
      for (let cy = Math.max(0, ccy - 1); cy <= Math.min(HROWS - 1, ccy + 1); cy++) {
        for (let cx = Math.max(0, ccx - 1); cx <= Math.min(HCOLS - 1, ccx + 1); cx++) {
          for (let j = head[cy * HCOLS + cx]; j >= 0; j = next[j]) {
            if (j <= i) continue;
            const b = units[j];
            if (!b.alive || b.flying !== a.flying) continue;
            const B = ints[j];
            if (B.leapT >= 0) continue;
            if (A2.strafe || B.strafe) continue;
            let dx = b.x - a.x, dy = b.y - a.y;
            const rr2 = A2.radius + B.radius;
            const d2 = dx * dx + dy * dy;
            if (d2 >= rr2 * rr2) continue;
            let d = Math.sqrt(d2);
            if (d < 1e-6) {
              const ang = (i * 7 + j * 13) % 16 * (TAU / 16);
              dx = Math.cos(ang);
              dy = Math.sin(ang);
              d = 1;
            } else {
              dx /= d;
              dy /= d;
            }
            const overlap = (rr2 - d) * 0.5;
            const tm = A2.mass + B.mass;
            const ka = B.mass / tm, kb = A2.mass / tm;
            a.x -= dx * overlap * ka;
            a.y -= dy * overlap * ka;
            b.x += dx * overlap * kb;
            b.y += dy * overlap * kb;
            if (a.side !== b.side && !a.flying) {
              if (A2.crush && A2.crushCd <= 0 && b.stats.size < a.stats.size) {
                A2.crushCd = CRUSH_EVERY;
                this.damage(b, CRUSH_DMG * a.stats.size, 0.5, 1, a.side, "crush", b.x, b.y);
              } else if (B.crush && B.crushCd <= 0 && a.stats.size < b.stats.size) {
                B.crushCd = CRUSH_EVERY;
                this.damage(a, CRUSH_DMG * b.stats.size, 0.5, 1, b.side, "crush", a.x, a.y);
              }
            }
          }
        }
      }
    }
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (!u.alive) continue;
      const r = ints[i].radius;
      u.x = clamp2(u.x, r, FIELD_W - r);
      u.y = clamp2(u.y, r, FIELD_H - r);
    }
  }
  // ---------------------------------------------------------------- end
  sideValue(side2) {
    let v = 0;
    for (const u of this.units) if (u.alive && u.side === side2) v += u.stats.cost * (u.hp / u.maxHp);
    return v;
  }
  /** Can any living unit of `side` still hurt a living enemy? (Static units only count with an enemy in range.) */
  sideCanHit(side2) {
    let enemyG = false, enemyA = false;
    for (const u of this.units) if (u.alive && u.side !== side2) {
      if (u.flying) enemyA = true;
      else enemyG = true;
    }
    for (let i = 0; i < this.ints.length; i++) {
      const I = this.ints[i];
      const u = I.u;
      if (!u.alive || u.side !== side2) continue;
      if (!(I.canHitA && enemyA || I.canHitG && enemyG || I.crush && enemyG)) continue;
      if (!I.isStatic) return true;
      for (const w of I.wpns) if (w && w.heal <= 0 && this.findTarget(u, w) >= 0) return true;
    }
    return false;
  }
  finish(winner) {
    this.done = true;
    this.winner = winner;
    this.events.push({ t: "end", winner });
  }
  checkEnd() {
    let a0 = 0, a1 = 0;
    for (const u of this.units) if (u.alive) {
      if (u.side === 0) a0++;
      else a1++;
    }
    if (a0 === 0 || a1 === 0) {
      this.finish(a0 === 0 && a1 === 0 ? -1 : a0 === 0 ? 1 : 0);
      return;
    }
    const stalled = this.tick % STALL_CHECK_EVERY === 0 && this.projs.length === 0 && !this.sideCanHit(0) && !this.sideCanHit(1);
    if (this.tick >= MAX_TICKS || stalled) {
      const v0 = this.sideValue(0), v1 = this.sideValue(1);
      this.finish(v0 > v1 * 1.1 ? 0 : v1 > v0 * 1.1 ? 1 : -1);
    }
  }
  summary() {
    const survivors = [[], []];
    for (const u of this.units) if (u.alive) survivors[u.side].push(u.uid);
    return {
      winner: this.winner,
      ticks: this.tick,
      survivors,
      damageDealt: [Math.round(this.damageDealt[0]), Math.round(this.damageDealt[1])]
    };
  }
};

// src/shared/starters.ts
var STARTER_DESIGNS = [
  // ---- cheap swarm ----
  { id: "starter-buzzsaw", name: "Buzzsaw", chassis: "scout", mobility: "wheels", mounts: ["mg"] },
  { id: "starter-torchbug", name: "Torchbug", chassis: "scout", mobility: "halftrack", mounts: ["flamer"] },
  // ---- skirmisher ----
  { id: "starter-lancer", name: "Lancer", chassis: "raider", mobility: "legs", mounts: ["laser", "laser"] },
  { id: "starter-hunter", name: "Tank Hunter", chassis: "raider", mobility: "legs", mounts: ["atgm", "atgm"] },
  // ---- frontline tank ----
  { id: "starter-bulwark", name: "Bulwark", chassis: "warden", mobility: "treads", mounts: ["autocannon", "plateL"] },
  // ---- anti-tank ----
  { id: "starter-tankbuster", name: "Tankbuster", chassis: "longarm", mobility: "halftrack", mounts: ["cannon"] },
  // ---- anti-air ----
  { id: "starter-skyguard", name: "Skyguard", chassis: "warden", mobility: "halftrack", mounts: ["flak", "hmg"] },
  // ---- artillery ----
  { id: "starter-thunderhead", name: "Thunderhead", chassis: "longarm", mobility: "spider", mounts: ["howitzer"] },
  { id: "starter-firestorm", name: "Firestorm", chassis: "striker", mobility: "spider", mounts: ["mortar", "mortar", "targeting"] },
  // ---- flyers ----
  { id: "starter-hornet", name: "Hornet", chassis: "drone", mobility: "rotor", mounts: ["mg"] },
  { id: "starter-strafer", name: "Strafer", chassis: "gunship", mobility: "jet", mounts: ["rockets", null] },
  // ---- support ----
  { id: "starter-medic", name: "Field Medic", chassis: "aegis", mobility: "halftrack", mounts: ["autocannon", "repair"] },
  // ---- brawler ----
  { id: "starter-stormcaller", name: "Stormcaller", chassis: "striker", mobility: "halftrack", mounts: ["tesla", "autocannon", "mg"] },
  // ---- size-3 heavies ----
  { id: "starter-behemoth", name: "Behemoth", chassis: "colossus", mobility: "treads", mounts: ["railgun", "cannon", "twin30", "hmg"] },
  { id: "starter-ironclad", name: "Ironclad", chassis: "bastion", mobility: "treads", mounts: ["cannon", "plateM", "autocannon"] },
  // ---- emplacement ----
  { id: "starter-spire", name: "Missile Spire", chassis: "warden", mobility: "anchor", mounts: ["sam", "mg"] },
  // ---- melee: fast hover brawler that dives into the line ----
  { id: "starter-ripper", name: "Ripper", chassis: "raider", mobility: "hover", mounts: ["buzzsaw", "shockprod"] },
  // ---- stealth: cloaked sniper platform ----
  { id: "starter-shade", name: "Shade", chassis: "striker", mobility: "halftrack", mounts: ["lightrail", "stealth", "sniper"] },
  // ---- shield wall: barrier-heavy anchor of the line ----
  { id: "starter-aegiswall", name: "Aegis Wall", chassis: "bastion", mobility: "treads", mounts: ["shieldH", "autocannon", "shield"] },
  // ---- support aura: command vehicle that speeds up and repairs its escorts ----
  { id: "starter-commander", name: "Commander", chassis: "striker", mobility: "halftrack", mounts: ["uplink", "autocannon", "repair"] }
];

// src/shared/match.ts
var DECK_SIZE = 9;

// src/shared/ai.ts
var profileCache = /* @__PURE__ */ new Map();
var designKey2 = (d) => `${d.chassis}|${d.mobility}|${d.mounts.join(",")}`;
function profile(d) {
  const key = designKey2(d);
  const hit = profileCache.get(key);
  if (hit) return hit;
  const s = computeStats(d);
  const mods = designModules(d);
  let aaDps = 0, groundDps = 0, apSum = 0, splashDps = 0, minRange = 0;
  for (const m of mods) {
    if (m.kind !== "weapon") continue;
    const dps = weaponDps2(m);
    if (m.targetsAir) aaDps += dps * (m.airBonus ?? 1);
    if (m.targetsGround !== false) {
      groundDps += dps;
      apSum += dps * (m.ap ?? 0);
    }
    if ((m.splash ?? 0) >= 0.8 || (m.chain ?? 0) > 0 || m.pierce) splashDps += dps * (1 + (m.splash ?? 0) + (m.chain ?? 0) * 0.5);
    if (m.minRange) minRange = Math.max(minRange, m.minRange);
  }
  const ehp = (s.hp + s.shield) * (1 + s.armor / 12) * (s.traits.includes("evasive") ? 1.3 : 1);
  const p = {
    stats: s,
    cost: s.cost,
    size: s.size,
    aaDps,
    groundDps,
    ap: groundDps > 0 ? apSum / groundDps : 0,
    splashDps,
    minRange,
    range: s.range,
    toughPerCost: ehp / Math.max(1, s.cost),
    ehp,
    flying: s.flying,
    isStatic: s.isStatic,
    heal: s.heal,
    role: "skirmisher"
  };
  p.role = classify(p);
  profileCache.set(key, p);
  return p;
}
function weaponDps2(w) {
  if (w.kind !== "weapon" || !w.damage || !w.cooldown) return 0;
  return w.damage * (w.burst ?? 1) * (w.pellets ?? 1) / w.cooldown;
}
function classify(p) {
  if (p.flying) return "flyer";
  if (p.heal > 0) return "support";
  if (p.range >= 9 && (p.minRange > 0 || p.groundDps === 0 || p.aaDps < p.groundDps * 0.5)) return "artillery";
  if (p.aaDps > 0 && (p.groundDps === 0 || p.aaDps >= p.groundDps * 1.4)) return "antiAir";
  if (p.ap >= 0.55 && p.groundDps > 0) return "antiArmor";
  if (p.cost <= 75) return "swarm";
  if (p.size >= 2 && p.toughPerCost >= 3.5) return "frontline";
  return "skirmisher";
}
var DESIGN_NAMES_A = ["Rust", "Iron", "Cinder", "Volt", "Grim", "Brass", "Storm", "Ash", "Hex", "Night", "Scrap", "Steel", "Dread", "Ember", "Gale"];
var DESIGN_NAMES_B = ["hound", "jaw", "fang", "wasp", "ram", "warden", "mantis", "beetle", "hawk", "golem", "viper", "crab", "lance", "maul", "kite"];
function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}
function shuffled(rng, arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function moduleWeight(m, role, firstSlot) {
  const isW = m.kind === "weapon";
  const hitsGround = isW && m.targetsGround !== false;
  const dps = weaponDps2(m);
  const cat = m.category;
  const armorW = m.kind === "armor" && !firstSlot;
  switch (role) {
    case "antiAir":
      if (cat === "antiair") return 4;
      return isW && m.targetsAir ? 1 + (m.airBonus ?? 1) * (hitsGround ? 1 : 2) : armorW ? 0.5 : 0;
    case "antiArmor":
      if (cat === "cannon" || cat === "missile" && m.targetsGround !== false && (m.ap ?? 0) >= 0.5) return 4;
      return hitsGround && (m.ap ?? 0) >= 0.5 ? 2 + (m.ap ?? 0) * 2 : armorW ? 0.6 : m.rangeBonus && !firstSlot ? 0.5 : 0;
    case "artillery":
      if (cat === "artillery") return 5;
      if (m.rangeBonus && !firstSlot) return 1.5;
      return hitsGround && (m.range ?? 0) >= 8 ? 2.5 : 0;
    case "frontline":
      if (armorW) return 2;
      if (m.shield) return 1.5;
      if (cat === "flame" || cat === "disruption") return 1.4;
      return hitsGround && (m.range ?? 0) <= 7 ? 1.3 : 0;
    case "support":
      if (m.heal) return firstSlot ? 4 : 1.5;
      return m.shield ? 1 : isW ? 0.8 : 0;
    case "flyer":
      if (cat === "artillery") return 0;
      return hitsGround ? 1 + dps / 80 + (cat === "rocket" ? 0.8 : 0) : 0;
    case "swarm":
      return hitsGround && m.mount === "L" && m.cost <= 20 ? 2 + (cat === "machinegun" || cat === "flame" ? 1 : 0) : 0;
    default:
      if (cat === "disruption" && !firstSlot) return 1.2;
      return isW ? 1 + dps / 100 : armorW ? 0.4 : m.rangeBonus && !firstSlot ? 0.4 : 0;
  }
}
function weightedPick(rng, items) {
  const total = items.reduce((s, i) => s + i.w, 0);
  if (total <= 0) return null;
  let r = rng() * total;
  for (const i of items) {
    r -= i.w;
    if (r <= 0) return i.item;
  }
  return items[items.length - 1].item;
}
function generateDesign(rng, role, id) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const chassisPool = CHASSIS.filter((c2) => {
      if (role === "swarm") return c2.size === 1;
      if (role === "frontline") return c2.size >= 2;
      if (role === "support") return c2.traits.includes("repairAura") || c2.size >= 2;
      return true;
    });
    if (!chassisPool.length) return null;
    const c = pick(rng, chassisPool);
    const mobPool = MOBILITY.filter((mb) => {
      if (pairingError(c.id, mb.id)) return false;
      if (role === "flyer") return mb.kind === "air";
      if (mb.kind === "air") return role === "antiArmor" ? false : rng() < 0.15;
      if (mb.kind === "static") return role === "artillery" || role === "antiAir" ? rng() < 0.35 : false;
      return true;
    });
    if (!mobPool.length) continue;
    const mob = pick(rng, mobPool);
    const mounts = c.mounts.map((slot, i) => {
      const cands = MODULES.filter((m) => fitsMount(slot, m.mount)).map((m) => ({ item: m.id, w: moduleWeight(m, role, i === 0) * (m.mount === slot ? 1.6 : 0.6) }));
      return weightedPick(rng, cands);
    });
    const d = { id, name: `${pick(rng, DESIGN_NAMES_A)}${pick(rng, DESIGN_NAMES_B)}`, chassis: c.id, mobility: mob.id, mounts };
    for (let k = mounts.length - 1; k > 0 && !acceptable(d, role); k--) d.mounts[k] = null;
    if (acceptable(d, role)) return d;
  }
  return null;
}
function acceptable(d, role) {
  if (validateDesign(d).length) return false;
  const p = profile(d);
  if (p.stats.load > 1.1) return false;
  if (p.groundDps + p.aaDps + p.heal <= 0) return false;
  if (role === "flyer") return p.flying && p.groundDps > 0;
  if (role === "antiAir") return p.aaDps > 0;
  return p.role === role || role === "frontline" && p.toughPerCost >= 3 || role === "skirmisher" && !p.flying;
}
var DECK_ROLES = ["frontline", "antiArmor", "antiAir", "artillery", "flyer", "swarm", "support", "skirmisher", "flyer"];
function aiDeck(seed, difficulty) {
  const rng = makeRng(mixSeed(seed >>> 0, 57028));
  const starters = shuffled(rng, STARTER_DESIGNS.filter((d) => validateDesign(d).length === 0));
  const deck = [];
  const used = /* @__PURE__ */ new Set();
  const add = (d) => {
    if (deck.length >= DECK_SIZE || used.has(designKey2(d))) return false;
    used.add(designKey2(d));
    deck.push({ ...d, mounts: [...d.mounts], id: `ai-${deck.length}-${d.id}`.slice(0, 40) });
    return true;
  };
  const genChance = difficulty === "easy" ? 0.6 : difficulty === "normal" ? 0.3 : 0.25;
  let gen = 0;
  for (const role of DECK_ROLES) {
    const fromStarter = starters.find((d) => !used.has(designKey2(d)) && profile(d).role === role);
    if (fromStarter && rng() >= genChance) {
      add(fromStarter);
      continue;
    }
    const g = generateDesign(rng, role, `gen${gen++}`);
    if (g) add(g);
    else if (fromStarter) add(fromStarter);
  }
  for (const d of starters) if (deck.length < DECK_SIZE) add(d);
  for (let i = 0; deck.length < DECK_SIZE && i < 20; i++) {
    const g = generateDesign(rng, pick(rng, DECK_ROLES), `gen${gen++}`);
    if (g) add(g);
  }
  return deck;
}

// src/client/artlab.ts
var params = new URLSearchParams(location.search);
var side = params.get("enemy") === "1" ? 1 : 0;
var only = params.get("only");
var $ = (sel) => document.querySelector(sel);
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}
var rngState = 12345;
var rnd2 = () => (rngState = rngState * 16807 % 2147483647) / 2147483647;
var pick2 = (a) => a[Math.floor(rnd2() * a.length)];
var WEAPONS = MODULES.filter((m) => m.kind === "weapon");
function fillMounts(chassisId, prefer) {
  const c = CHASSIS.find((x) => x.id === chassisId);
  return c.mounts.map((slot, i) => {
    const fit = WEAPONS.filter((m) => m.mount === slot);
    const any = fit.length ? fit : WEAPONS.filter((m) => fitsMount(slot, m.mount));
    return any[(prefer * 7 + i * 13) % any.length].id;
  });
}
var animated = [];
function preview(d, size, label, sub) {
  const box = el("div", "cell");
  const c = el("canvas");
  c.style.width = c.style.height = size + "px";
  box.append(c);
  if (label) box.append(el("div", "lab", label));
  if (sub) box.append(el("div", "sub", sub));
  animated.push({ c, d });
  return box;
}
function gridSection() {
  const host = $("#grid");
  const table = el("table");
  const head = el("tr");
  head.append(el("th", "", ""));
  for (const m of MOBILITY) head.append(el("th", "", m.name));
  table.append(head);
  CHASSIS.forEach((c, ci) => {
    const tr = el("tr");
    tr.append(el("th", "rowh", `${c.name} (${c.size})`));
    MOBILITY.forEach((m, mi) => {
      const td = el("td");
      if (!pairingError(c.id, m.id)) {
        const d = { id: `g${ci}_${mi}`, name: "x", chassis: c.id, mobility: m.id, mounts: fillMounts(c.id, ci + mi) };
        td.append(preview(d, 96));
      } else td.className = "na";
      tr.append(td);
    });
    table.append(tr);
  });
  host.append(table);
}
function refChassis(m) {
  if (m.mount === "L") return { chassis: "scout", mobility: "wheels", slot: 0 };
  if (m.mount === "M") return { chassis: "warden", mobility: "halftrack", slot: 0 };
  return { chassis: "longarm", mobility: "treads", slot: 0 };
}
function modulesSection() {
  const host = $("#modules");
  for (const m of MODULES) {
    const r = refChassis(m);
    const c = CHASSIS.find((x) => x.id === r.chassis);
    const mounts = c.mounts.map(() => null);
    mounts[r.slot] = m.id;
    const d = { id: "m_" + m.id, name: m.name, chassis: r.chassis, mobility: r.mobility, mounts };
    host.append(preview(d, 110, m.name, `${m.id} \xB7 ${m.mount} \xB7 ${m.visual}`));
  }
}
function iconsSection() {
  const host = $("#icons");
  const add = (kind, id, name) => {
    const box = el("div", "icon");
    const c = el("canvas");
    c.style.width = c.style.height = "72px";
    box.append(c, el("div", "lab", name), el("div", "sub", id));
    host.append(box);
    requestAnimationFrame(() => drawPartIcon(c, kind, id, { backdrop: true, team: side === 1 ? 1 : void 0 }));
  };
  for (const c of CHASSIS) add("chassis", c.id, c.name);
  for (const m of MOBILITY) add("mobility", m.id, m.name);
  for (const m of MODULES) add("module", m.id, m.name);
}
function smallSection() {
  const host = $("#small");
  const designs = randomDesigns(24, 99);
  for (const d of designs) {
    const size = computeStats(d).size;
    host.append(preview(d, 20 * size + 8));
  }
}
function randomDesigns(n, seed) {
  rngState = seed;
  const out2 = [];
  let guard = 0;
  while (out2.length < n && guard++ < 5e3) {
    const c = pick2(CHASSIS), m = pick2(MOBILITY);
    if (pairingError(c.id, m.id)) continue;
    const mounts = c.mounts.map((slot) => {
      const fit = MODULES.filter((x) => fitsMount(slot, x.mount) && (x.kind !== "armor" || rnd2() < 0.3));
      return pick2(fit).id;
    });
    const d = { id: `r${out2.length}_${seed}`, name: "Rnd", chassis: c.id, mobility: m.id, mounts };
    if (isValidDesign(d)) out2.push(d);
  }
  return out2;
}
function makeDeck(seed) {
  try {
    const d = aiDeck(seed, "hard");
    if (d.length >= 4) return d;
  } catch {
  }
  return randomDesigns(8, seed);
}
function placeUnits(deck, seed, count) {
  rngState = seed;
  const out2 = [];
  let guard = 0;
  while (out2.length < count && guard++ < 2e3) {
    const d = pick2(deck);
    const s = computeStats(d).size;
    const x = Math.floor(rnd2() * (DEPLOY_W - s + 1)), y = Math.floor(rnd2() * (DEPLOY_D - s + 1));
    if (!inDeployZone(x, y, s)) continue;
    if (out2.some((p) => overlaps(p.x, p.y, computeStats(deck.find((q) => q.id === p.designId)).size, x, y, s))) continue;
    out2.push({ uid: out2.length + 1, designId: d.id, x, y, level: 1 + Math.floor(rnd2() * 3), round: 1 });
  }
  return out2;
}
function fieldSection() {
  const canvas = $("#field");
  const view = new FieldView(canvas, side);
  let battle = null;
  let board = [];
  let acc = 0;
  let speed = Number(params.get("speed") ?? "1") || 1;
  let seed = Number(params.get("seed") ?? "7") || 7;
  const status = $("#status");
  const setup = () => {
    const decks = [makeDeck(seed), makeDeck(seed + 1e3)];
    const count = Number(params.get("n") ?? "14") || 14;
    const units = [placeUnits(decks[0], seed, count), placeUnits(decks[1], seed + 5, count)];
    board = [];
    for (const s of [0, 1]) {
      for (const p of units[s]) {
        const d = decks[s].find((q) => q.id === p.designId);
        const c = placementCenter(s, p, computeStats(d).size);
        board.push({ side: s, design: d, x: c.x, y: c.y, level: p.level });
      }
    }
    const input2 = { seed, sides: [{ designs: decks[0], units: units[0] }, { designs: decks[1], units: units[1] }] };
    return input2;
  };
  let input = setup();
  $("#demo").onclick = () => {
    unlockAudio();
    playMusic("battle");
    seed++;
    input = setup();
    battle = new Battle(input);
    acc = 0;
  };
  $("#reset").onclick = () => {
    battle = null;
    seed++;
    input = setup();
    playMusic("deploy");
    unlockAudio();
  };
  $("#speed").onchange = (e) => {
    speed = Number(e.target.value);
  };
  if (params.get("battle") === "1") battle = new Battle(input);
  let hover = null;
  canvas.addEventListener("mousemove", (e) => {
    const w = view.screenToWorld(e.offsetX, e.offsetY);
    hover = { col: Math.floor(w.x), row: Math.floor(w.y), size: 2, valid: side === 0 ? w.y > 23 : w.y < 9 };
  });
  canvas.addEventListener("mouseleave", () => {
    hover = null;
  });
  new ResizeObserver(() => view.resize()).observe(canvas);
  let last = performance.now();
  let fps = 60, drawMs = 0;
  const frame = (now) => {
    const dt = Math.min(0.1, (now - last) / 1e3);
    fps = fps * 0.95 + 1 / Math.max(1e-3, (now - last) / 1e3) * 0.05;
    last = now;
    const t0 = performance.now();
    if (battle) {
      acc += dt * TICK_RATE * speed;
      let n = 0;
      while (acc >= 1 && !battle.done && n++ < 40) {
        battle.step();
        view.pushEvents(battle.events);
        acc -= 1;
      }
      view.drawBattle(battle, dt);
      drawMs = drawMs * 0.9 + (performance.now() - t0) * 0.1;
      const alive = [0, 1].map((s) => battle.units.filter((u) => u.alive && u.side === s).length);
      status.textContent = `tick ${battle.tick} \xB7 blue ${alive[side]} vs red ${alive[1 - side]} \xB7 fx ${view.fx.parts.length} \xB7 ${fps.toFixed(0)} fps \xB7 frame ${drawMs.toFixed(1)}ms${battle.done ? " \xB7 done" : ""}`;
    } else {
      view.drawBoard(board, { showZone: true, hover }, now / 1e3);
      status.textContent = "deploy board (hover to see footprint)";
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
function animate() {
  let t0 = performance.now();
  const loop = (now) => {
    const t = (now - t0) / 1e3;
    for (const a of animated) {
      const r = a.c.getBoundingClientRect();
      if (r.bottom < -50 || r.top > innerHeight + 50) continue;
      drawUnitPreview(a.c, a.d, { side, time: t });
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  void t0;
}
function main() {
  document.body.classList.toggle("enemy", side === 1);
  const show = (id) => !only || only === id;
  for (const id of ["grid", "modules", "icons", "small", "field"]) if (!show(id)) $("#sec-" + id).style.display = "none";
  if (show("field")) fieldSection();
  if (show("grid")) gridSection();
  if (show("modules")) modulesSection();
  if (show("icons")) iconsSection();
  if (show("small")) smallSection();
  animate();
  addEventListener("pointerdown", () => unlockAudio(), { once: true });
}
main();
