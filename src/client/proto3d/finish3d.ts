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
// Weapons (per turret) always take their GROUP's barrel finish (never the hull's), so a player reads a weapon family
// from its barrels and not every barrel is black (by category; coil / emitter looks first):
//   gauss / rail                                                   silver bores, copper coil rings
//   tesla / emp / heat-ray, other disruption                       copper coils;  sonic  brass;  flame  oiled bronze
//   precision (snipers), energy (lasers, plasma), melee            silver
//   machine guns                                                   gunmetal grey
//   autocannons, flak                                              blued (blue-black)
//   cannons                                                        blued tubes, brass breech rings on L / XL
//   artillery                                                      gunmetal tube, brass breech rings
//   rockets, missiles, bombs, utilities                            the hull's finish
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


function weaponFinish(m: ModuleDef, hull: MetalFinish): FinishSpec {
  // coil / emitter weapons first (their look, whatever the category)
  switch (m.visual) {
    case 'gauss': case 'rail': return { joint: 'silver', fitting: 'copper' };
    case 'tesla': case 'emp': case 'heatray': return { joint: 'copper', fitting: 'copper' };
    case 'sonic': return { joint: 'brass' };
    case 'flamer': return { joint: 'bronze' };
  }
  switch (m.category) {
    case 'machinegun': return { joint: 'gunmetal' };
    case 'autocannon': case 'antiair': return { joint: 'blued' };
    case 'cannon': return { joint: 'blued', fitting: m.mount === 'L' || m.mount === 'XL' ? 'brass' : 'blued' };
    case 'precision': case 'energy': case 'melee': return { joint: 'silver' };
    case 'artillery': return { joint: 'gunmetal', fitting: 'brass' };
    case 'disruption': return { joint: 'copper', fitting: 'copper' };
    case 'flame': return { joint: 'bronze' };
    default: return { joint: hull }; // launchers, bombs, utilities
  }
}

/** Finish of the hull / running gear and of each mounted weapon (index = mount; null = empty). */
export function pickFinish(design: Design, ch: ChassisDef, mob: MobilityDef, mods: (ModuleDef | null)[], skin: Skin): { hull: FinishSpec; turret: (FinishSpec | null)[] } {
  const hull = hullFinish(design, mob, skin);
  return { hull: { joint: hull }, turret: mods.map((m) => (m ? weaponFinish(m, hull) : null)) };
}
