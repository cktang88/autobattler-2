// Which surface skin (surface3d.ts LAYER) a unit wears, chosen at build time from its role, domain and scale, and the
// per-vertex `sdv` / `sdb` attributes that carry the choice to the shared per-team material.
//
//   aircraft (jet)            -> air        riveted aluminium skin, long panels, walkway / chevron markings, clean
//   rotor / heli / gravlift   -> rotor      skin panels + intake grilles, exhaust soot
//   creature chassis          -> carapace   chitin plates, no rivets (saucer -> ceramic)
//   cloaked (stealth module)  -> stealth    faceted matte tiles, no markings
//   support (repair / shield / uplink / sensor, aegis)  -> support   clean panels, role crosses / rings in team accent
//   melee brawlers (>= 1/4)   -> brawler    dented, gouged, scraped
//   energy-weapon heavy       -> ceramic    high-tech: dark gunmetal plates over mesh, hex cells, team-accent plates, lights
//   artillery / siege         -> arty       utilitarian ribbed / strapped plates, hazard stencils, dust
//   titans and giants (4-5)   -> titan      huge riveted plates, battle damage
//   heavy (3)                 -> dullmetal  bare scratched metal: chamfered panels, vents, pipe runs, engraved traces
//   medium (2)                -> cast       pitted cast armour, weld beads, bolted add-on plates
//   light (1)                 -> scout      fine panels, many small hatches, small stencils, camo
// (slab: layered slab armour, big bolts, pooled grime -- now worn by giants' turrets)
// Turrets wear a skin for their weapon (energy -> ceramic, artillery / missiles -> arty, melee -> brawler, support ->
// support) or the hull's. Running gear joints get machinery. Giants also mix by part (see surface3d.ts).
// Texel density is per size class, so plates grow with the unit.

import * as THREE from 'three';
import type { ChassisDef, Design, MobilityDef, ModuleDef } from '../../shared/types.ts';
import { LAYER, type LayerName } from './surface3d.ts';

/** object-space units (cells) one texture tile spans, per size class 1..5 */
const TILE_SPAN = [0, 0.95, 1.3, 1.8, 2.4, 3.0];
const CREATURES = new Set(['mantis', 'arachnid', 'crab', 'centipede', 'scorpion', 'broodmother', 'arachne', 'leviathan']);
const SUPPORT_UTIL = new Set(['support']);

export interface Skin {
  hull: LayerName;
  /** giants: skin of the superstructure panels */
  secondary: LayerName | null;
  /** per-mount turret skin (index = mount) */
  turret: (LayerName | null)[];
  /** texture tiles per object unit */
  density: number;
  giant: boolean;
  /** size class 1..5 */
  size: number;
}

function turretSkin(m: ModuleDef | null, hull: LayerName, giant: boolean): LayerName | null {
  if (!m) return null;
  if (hull === 'stealth' || hull === 'carapace') return hull;
  if (m.category === 'energy') return 'ceramic';
  if (m.category === 'artillery' || m.category === 'bomb' || m.category === 'missile' || m.category === 'rocket') return 'arty';
  if (m.category === 'melee') return 'brawler';
  if (SUPPORT_UTIL.has(m.category) || m.category === 'defense') return 'support';
  return giant ? (hull === 'titan' ? 'slab' : hull) : hull;
}

export function pickSkin(design: Design, ch: ChassisDef, mob: MobilityDef, mods: (ModuleDef | null)[]): Skin {
  const S = Math.max(1, Math.min(5, ch.size));
  const giant = S >= 4;
  const ms = mods.filter((m): m is ModuleDef => !!m);
  const weps = ms.filter((m) => m.kind === 'weapon');
  const share = (pred: (m: ModuleDef) => boolean, list = weps) => (list.length ? list.filter(pred).length / list.length : 0);
  const roles = ch.roles ?? [];
  let hull: LayerName;
  if (ch.domain === 'jet' || mob.id === 'jet') hull = 'air';
  else if (ch.domain === 'heli' || mob.kind === 'air') hull = 'rotor';
  else if (ch.shape === 'saucer') hull = 'ceramic';
  else if (CREATURES.has(ch.id) || CREATURES.has(ch.shape)) hull = 'carapace';
  else if (ms.some((m) => m.category === 'stealth' && /cloak|veil/i.test(m.name))) hull = 'stealth';
  else if (roles.includes('support') || share((m) => SUPPORT_UTIL.has(m.category), ms) >= 0.5) hull = 'support';
  else if (roles.includes('melee') || share((m) => m.category === 'melee') >= 0.25) hull = 'brawler';
  else if (share((m) => m.category === 'energy') >= 0.5) hull = 'ceramic';
  else if (giant) hull = 'titan';
  else if (roles.includes('artillery') || share((m) => m.category === 'artillery') >= 0.5) hull = 'arty';
  else hull = S >= 3 ? 'dullmetal' : S === 2 ? 'cast' : 'scout';
  const secondary: LayerName | null = !giant ? null
    : hull === 'carapace' ? 'ceramic' : hull === 'air' || hull === 'rotor' ? 'scout' : hull === 'ceramic' ? 'scout' : 'scout';
  return { hull, secondary, turret: mods.map((m) => turretSkin(m, hull, giant)), density: 1 / TILE_SPAN[S], giant, size: S };
}

function setAttr(g: THREE.BufferGeometry, name: string, v: [number, number, number, number]): void {
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) a.set(v, i * 4);
  g.setAttribute(name, new THREE.BufferAttribute(a, 4));
}

/** Write the skin attributes onto every mesh of a freshly built unit that uses the shared uber material. */
export function applySkin(root: THREE.Object3D, body: THREE.Object3D, turretRoots: { obj: THREE.Object3D; mount: number }[], uber: THREE.Material, skin: Skin, designId: string): void {
  const prim = LAYER[skin.hull];
  const sec = skin.secondary ? LAYER[skin.secondary] + 1 : 0;
  const turretOf = new Map<THREE.Object3D, number>();
  for (const t of turretRoots) turretOf.set(t.obj, t.mount);
  const regionOf = (o: THREE.Object3D): { region: number; mount: number } => {
    let underBody = false;
    for (let p: THREE.Object3D | null = o; p; p = p.parent) {
      const m = turretOf.get(p);
      if (m !== undefined) return { region: 1, mount: m };
      if (p === body) underBody = true;
      if (p === root) break;
    }
    return { region: underBody ? 0 : 2, mount: -1 };
  };
  const hullMeshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    const me = o as THREE.Mesh;
    if (!me.isMesh || me.material !== uber) return;
    const { region, mount } = regionOf(me);
    const layer = region === 1 ? LAYER[skin.turret[mount] ?? skin.hull] : prim;
    setAttr(me.geometry, 'sdv', [layer, skin.density, prim, sec + 32 * region]);
    if (region === 0) hullMeshes.push(me);
  });
  if (skin.size < 3 || !hullMeshes.length || skin.hull === 'stealth' || skin.hull === 'carapace') return;
  // hull markings (size 3+): numerals on the flanks a little ahead of centre, at ~60% hull height; insignia behind them
  const box = new THREE.Box3();
  for (const me of hullMeshes) { me.geometry.computeBoundingBox(); box.union(me.geometry.boundingBox!); }
  const size = box.getSize(new THREE.Vector3());
  // small stencilled numerals (~40% of the old poster-sized ones): big digits read as toy branding
  const h = Math.max(0.11, Math.min(size.y * 0.1, size.x * 0.038, 0.3));
  let hash = 7;
  for (const c of designId) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  const num = 10 + (hash % 90);
  const cx = box.min.x + size.x * 0.6, cy = box.min.y + size.y * 0.6;
  for (const me of hullMeshes) setAttr(me.geometry, 'sdb', [cx, cy, h, num]);
}
