// Starter designs: seed for new players' garage and for AI decks. All must pass validateDesign
// (see test/match.test.ts).

import type { Design } from './types.ts';

export const STARTER_DESIGNS: Design[] = [
  // ---- cheap swarm ----
  { id: 'starter-buzzsaw', name: 'Buzzsaw', chassis: 'scout', mobility: 'wheels', mounts: ['mg'] },
  { id: 'starter-torchbug', name: 'Torchbug', chassis: 'scout', mobility: 'halftrack', mounts: ['flamer'] },
  // ---- skirmisher ----
  { id: 'starter-lancer', name: 'Lancer', chassis: 'raider', mobility: 'legs', mounts: ['laser', 'laser'] },
  { id: 'starter-hunter', name: 'Tank Hunter', chassis: 'raider', mobility: 'legs', mounts: ['atgm', 'atgm'] },
  // ---- frontline tank ----
  { id: 'starter-bulwark', name: 'Bulwark', chassis: 'warden', mobility: 'treads', mounts: ['autocannon', 'plateL'] },
  // ---- anti-tank ----
  { id: 'starter-tankbuster', name: 'Tankbuster', chassis: 'longarm', mobility: 'halftrack', mounts: ['cannon'] },
  // ---- anti-air ----
  { id: 'starter-skyguard', name: 'Skyguard', chassis: 'warden', mobility: 'halftrack', mounts: ['flak', 'hmg'] },
  // ---- artillery ----
  { id: 'starter-thunderhead', name: 'Thunderhead', chassis: 'longarm', mobility: 'spider', mounts: ['howitzer'] },
  { id: 'starter-firestorm', name: 'Firestorm', chassis: 'striker', mobility: 'spider', mounts: ['mortar', 'mortar', 'targeting'] },
  // ---- flyers ----
  { id: 'starter-hornet', name: 'Hornet', chassis: 'drone', mobility: 'rotor', mounts: ['mg'] },
  { id: 'starter-strafer', name: 'Strafer', chassis: 'gunship', mobility: 'jet', mounts: ['rockets', null] },
  // ---- support ----
  { id: 'starter-medic', name: 'Field Medic', chassis: 'aegis', mobility: 'halftrack', mounts: ['autocannon', 'repair'] },
  // ---- brawler ----
  { id: 'starter-stormcaller', name: 'Stormcaller', chassis: 'striker', mobility: 'halftrack', mounts: ['tesla', 'autocannon', 'mg'] },
  // ---- size-3 heavies ----
  { id: 'starter-behemoth', name: 'Behemoth', chassis: 'colossus', mobility: 'treads', mounts: ['railgun', 'cannon', 'twin30', 'hmg'] },
  { id: 'starter-ironclad', name: 'Ironclad', chassis: 'bastion', mobility: 'treads', mounts: ['cannon', 'plateM', 'autocannon'] },
  // ---- emplacement ----
  { id: 'starter-spire', name: 'Missile Spire', chassis: 'warden', mobility: 'anchor', mounts: ['sam', 'mg'] },
];
