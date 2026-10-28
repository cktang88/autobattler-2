// Bare-metal finish of a unit's mechanics (materials.ts METAL_FINISH: the joint / metal role = pistons, axles, hinges,
// barrels), chosen deterministically at build time from the design, so not every joint and barrel is gunmetal-black.
//
// Hull + running gear (one finish per unit), from its surface skin (skins.ts: role / domain / size) + mobility:
//   jet / rotor aircraft    dark chrome (landing-gear oleos, hydraulics)          rotor: some gunmetal
//   ceramic (energy, saucer), support    dark chrome (clean, well kept)          support: some gunmetal
//   carapace (creatures)    oiled bronze (biomechanical sheen), some gunmetal
//   stealth                 gunmetal (no glints)
//   titan (size 4-5)        gunmetal / oiled bronze / dark chrome (big industrial hydraulics)
//   slab (heavy 3)          mostly gunmetal, some dark chrome or bronze
//   cast (medium 2)         mostly gunmetal, some blued or chrome
//   scout (light 1)         blued steel or gunmetal, a little chrome
//   arty                    gunmetal or blued;    brawler   gunmetal, blued or bronze
//   legged walkers: half the gunmetal ones get chrome pistons (exposed leg hydraulics catch the light)
// Weapons (per turret) override for their barrels / coils / emitters:
//   gauss / rail / plasma                                          dark chrome bores, copper coil rings (kit.fitting)
//   sniper, laser / slowbeam / gravity                             dark chrome (precision bores, polished emitters)
//   tesla / emp / heat-ray                                         copper coils
//   sonic                                                          brass;   flamer   oiled bronze nozzles
//   howitzer / mortar                                              blued or gunmetal tube, brass breech rings
//   saw / blade / drill / chainsaw                                 dark chrome (polished working steel)
//   guns / cannons / autocannons / flak                            the hull's finish (warm hull finishes -> gunmetal:
//                                                                  no copper tank barrels); siege calibres: brass rings
//   launchers, hammers, utility                                    the hull's finish
// Roughly half of all units stay plain gunmetal; warm metals stay rare and every finish is dark-to-mid and low-chroma.

import type { ChassisDef, Design, MobilityDef, ModuleDef } from '../../shared/types.ts';
import type { FinishSpec, MetalFinish } from './materials.ts';
import type { Skin } from './skins.ts';

const LEGGED = new Set(['legs', 'spider', 'jumpjets', 'titanlegs']);

/** deterministic 0..1 from a string + salt (independent of the builders' rnd stream) */
function h01(s: string, salt: number): number {
  let h = (0x811c9dc5 ^ salt) >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

/** weighted pick: [finish, weight][] */
function pick(u: number, opts: [MetalFinish, number][]): MetalFinish {
  const tot = opts.reduce((a, o) => a + o[1], 0);
  let x = u * tot;
  for (const [f, w] of opts) { if ((x -= w) < 0) return f; }
  return opts[opts.length - 1][0];
}

function hullFinish(design: Design, mob: MobilityDef, skin: Skin): MetalFinish {
  const u = h01(design.id, 17);
  let f: MetalFinish;
  switch (skin.hull) {
    case 'air': f = 'chrome'; break;
    case 'rotor': f = pick(u, [['chrome', 3], ['gunmetal', 2]]); break;
    case 'ceramic': f = 'chrome'; break;
    case 'support': f = pick(u, [['chrome', 3], ['gunmetal', 1]]); break;
    case 'carapace': f = pick(u, [['bronze', 3], ['gunmetal', 2]]); break;
    case 'stealth': f = 'gunmetal'; break;
    case 'titan': f = pick(u, [['gunmetal', 2], ['bronze', 2], ['chrome', 1.5]]); break;
    case 'arty': f = pick(u, [['gunmetal', 3], ['blued', 2]]); break;
    case 'brawler': f = pick(u, [['gunmetal', 2], ['blued', 1], ['bronze', 1]]); break;
    case 'slab': f = pick(u, [['gunmetal', 5], ['chrome', 2], ['bronze', 1.5]]); break;
    case 'dullmetal': f = pick(u, [['gunmetal', 4], ['bronze', 1.5]]); break;
    case 'cast': f = pick(u, [['gunmetal', 5], ['blued', 2], ['chrome', 1.5]]); break;
    case 'scout': f = pick(u, [['blued', 4], ['gunmetal', 4], ['chrome', 1.5]]); break;
    default: f = 'gunmetal';
  }
  if (f === 'gunmetal' && LEGGED.has(mob.id) && skin.hull !== 'stealth' && h01(design.id, 29) < 0.5) f = 'chrome';
  return f;
}

const WARM = new Set<MetalFinish>(['bronze', 'copper', 'brass']);

function weaponFinish(m: ModuleDef, hull: MetalFinish, design: Design, i: number): FinishSpec {
  const v = m.visual;
  switch (v) {
    // coil guns: polished bores, copper coil rings round the barrel
    case 'gauss': case 'rail': case 'plasma': return { joint: 'chrome', fitting: 'copper' };
    case 'sniper': case 'laser': case 'slowbeam': case 'gravity':
    case 'saw': case 'blade': case 'drill': case 'chainsaw':
      return { joint: 'chrome' };
    case 'tesla': case 'emp': case 'heatray': return { joint: 'copper', fitting: 'copper' };
    case 'sonic': return { joint: 'brass' };
    case 'flamer': return { joint: 'bronze' };
    case 'artillery': case 'mortar':
      return { joint: h01(design.id, 41 + i) < 0.5 ? 'blued' : 'gunmetal', fitting: 'brass' };
    case 'gun': case 'cannon': case 'gatling': case 'shotgun': case 'flak': case 'pointdef': {
      const j: MetalFinish = WARM.has(hull) ? 'gunmetal' : hull;
      // siege calibres (L / XL cannons) get brass breech rings
      return { joint: j, fitting: v === 'cannon' && (m.mount === 'L' || m.mount === 'XL') ? 'brass' : j };
    }
    default: return { joint: hull };
  }
}

/** Finish of the hull / running gear and of each mounted weapon (index = mount; null = empty). */
export function pickFinish(design: Design, ch: ChassisDef, mob: MobilityDef, mods: (ModuleDef | null)[], skin: Skin): { hull: FinishSpec; turret: (FinishSpec | null)[] } {
  const hull = hullFinish(design, mob, skin);
  return { hull: { joint: hull }, turret: mods.map((m, i) => (m ? weaponFinish(m, hull, design, i) : null)) };
}
