// Starter designs: seed for new players' garage and for AI decks. All must pass validateDesign
// (see test/match.test.ts).

import type { Design } from './types.ts';

export const STARTER_DESIGNS: Design[] = [
  // ---- cheap swarm ----
  { id: 'starter-buzzsaw', name: 'Buzzsaw', chassis: 'scout', mobility: 'wheels', mounts: ['mg'] },
  { id: 'starter-torchbug', name: 'Torchbug', chassis: 'scout', mobility: 'halftrack', mounts: ['flamer'] },
  // ---- skirmisher ----
  { id: 'starter-lancer', name: 'Lancer', chassis: 'raider', mobility: 'halftrack', mounts: ['laser', 'laser'] },
  { id: 'starter-hunter', name: 'Tank Hunter', chassis: 'raider', mobility: 'legs', mounts: ['atgm', 'atgm'] },
  // ---- frontline tank ----
  { id: 'starter-bulwark', name: 'Bulwark', chassis: 'warden', mobility: 'treads', mounts: ['autocannon', 'plateL'] },
  // ---- anti-tank ----
  { id: 'starter-tankbuster', name: 'Tankbuster', chassis: 'longarm', mobility: 'spider', mounts: ['cannon'] },
  // ---- anti-air ----
  { id: 'starter-skyguard', name: 'Skyguard', chassis: 'warden', mobility: 'halftrack', mounts: ['ac40', 'ac20'] },
  // ---- artillery ----
  { id: 'starter-thunderhead', name: 'Thunderhead', chassis: 'longarm', mobility: 'spider', mounts: ['howitzer'] },
  { id: 'starter-firestorm', name: 'Firestorm', chassis: 'striker', mobility: 'spider', mounts: ['mortar', 'mortar', null] },
  // ---- flyers ----
  { id: 'starter-hornet', name: 'Hornet', chassis: 'drone', mobility: 'rotor', mounts: ['twinmg'] },
  { id: 'starter-strafer', name: 'Strafer', chassis: 'strikejet', mobility: 'jet', mounts: ['rockets', 'guidedrocket', 'hmg'] },
  // ---- support ----
  { id: 'starter-medic', name: 'Field Medic', chassis: 'aegis', mobility: 'halftrack', mounts: ['autocannon', 'repair'] },
  // ---- brawler ----
  { id: 'starter-stormcaller', name: 'Voltrider', chassis: 'striker', mobility: 'halftrack', mounts: ['minigun', 'twin30', 'shotgun'] },
  // ---- size-3 heavies ----
  { id: 'starter-behemoth', name: 'Ironbreaker', chassis: 'colossus', mobility: 'treads', mounts: ['railgun', 'cannon', 'twin30', 'hmg'] },
  { id: 'starter-ironclad', name: 'Ironclad', chassis: 'bastion', mobility: 'treads', mounts: ['cannon', 'plateM', 'autocannon'] },
  // ---- emplacement ----
  { id: 'starter-spire', name: 'Missile Spire', chassis: 'warden', mobility: 'spider', mounts: ['guidedrocket', 'hmg'] },
  // ---- melee: fast hover brawler that dives into the line ----
  { id: 'starter-ripper', name: 'Gnasher', chassis: 'mantis', mobility: 'legs', mounts: ['buzzsaw', 'shockprod'] },
  // ---- stealth: cloaked sniper platform ----
  { id: 'starter-shade', name: 'Shade', chassis: 'striker', mobility: 'halftrack', mounts: ['lightrail', 'stealth', 'sniper'] },
  // ---- shield wall: barrier-heavy anchor of the line ----
  { id: 'starter-aegiswall', name: 'Aegis Wall', chassis: 'bastion', mobility: 'treads', mounts: ['shieldH', 'cannon75', 'shield'] },
  // ---- support aura: command vehicle that speeds up and repairs its escorts ----
  { id: 'starter-commander', name: 'Commander', chassis: 'striker', mobility: 'halftrack', mounts: ['uplink', 'twin30', 'hmg'] },
  // ---- giant (size 4): all-round assault walker ----
  { id: 'starter-juggernaut', name: 'Gargantua', chassis: 'goliath', mobility: 'megatracks', mounts: ['avenger', 'cannon', 'cannon', 'autocannon'] },
  // ---- titan (size 5): beam-armed war machine ----
  { id: 'starter-warlord', name: 'Kronos', chassis: 'titan', mobility: 'megatracks', mounts: ['annihilator', 'siegeplasma', 'cannon', 'cannon', 'autocannon'] },
  // ---- giant bomber (size 4): strategic jet bomber, a blockbuster in the middle bay, guns at chin and tail ----
  { id: 'starter-thunderbird', name: 'Thunderbird', chassis: 'strategic', mobility: 'jet', mounts: ['bombs', 'bombs', 'heavybomb', 'bombs', 'hmg', 'hmg'] },
];
