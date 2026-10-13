// Starter designs: seed for new players' garage and for AI decks. All must pass validateDesign
// (see test/match-starters.test.ts). Costs noted are computeStats().cost at time of writing.

import type { Design } from './types.ts';

export const STARTER_DESIGNS: Design[] = [
  // ---- cheap swarm ----
  { id: 'starter-buzzsaw', name: 'Buzzsaw', chassis: 'scout', mobility: 'wheels', mounts: ['mg'] }, // ~45
  { id: 'starter-torchbug', name: 'Torchbug', chassis: 'scout', mobility: 'halftrack', mounts: ['flamer'] }, // ~55
  // ---- skirmisher ----
  { id: 'starter-lancer', name: 'Lancer', chassis: 'raider', mobility: 'legs', mounts: ['laser', 'laser'] }, // ~95
  // ---- frontline tank ----
  { id: 'starter-bulwark', name: 'Bulwark', chassis: 'warden', mobility: 'treads', mounts: ['autocannon', 'plateL'] }, // ~185
  // ---- anti-tank ----
  { id: 'starter-tankbuster', name: 'Tankbuster', chassis: 'longarm', mobility: 'halftrack', mounts: ['cannon'] }, // ~195
  // ---- anti-air ----
  { id: 'starter-skyguard', name: 'Skyguard', chassis: 'warden', mobility: 'halftrack', mounts: ['flak', 'mg'] }, // ~165
  // ---- artillery ----
  { id: 'starter-thunderhead', name: 'Thunderhead', chassis: 'longarm', mobility: 'spider', mounts: ['howitzer'] }, // ~230
  // ---- flyers ----
  { id: 'starter-hornet', name: 'Hornet', chassis: 'drone', mobility: 'rotor', mounts: ['mg'] }, // ~60
  { id: 'starter-strafer', name: 'Strafer', chassis: 'gunship', mobility: 'jet', mounts: ['rockets', null] }, // ~220
  // ---- support ----
  { id: 'starter-medic', name: 'Field Medic', chassis: 'aegis', mobility: 'halftrack', mounts: ['autocannon', 'repair'] }, // ~215
  // ---- brawler ----
  { id: 'starter-stormcaller', name: 'Stormcaller', chassis: 'striker', mobility: 'halftrack', mounts: ['tesla', 'autocannon', 'mg'] }, // ~220
  // ---- size-3 heavy ----
  { id: 'starter-ironclad', name: 'Ironclad', chassis: 'bastion', mobility: 'treads', mounts: ['cannon', 'plateM', 'autocannon'] }, // ~420
  // ---- emplacement ----
  { id: 'starter-spire', name: 'Missile Spire', chassis: 'warden', mobility: 'anchor', mounts: ['sam', 'mg'] }, // ~150
];
