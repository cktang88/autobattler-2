// Legacy fallback running gear, kept only for mobility/generic.ts (ids without a stylized builder: 'generic', flyers).
// Wheels, half-track, hover and anchor live in mobility/wheels.ts, hover.ts, anchor.ts; tracks in mobility/tracks.ts,
// legs in mobility/legs.ts. Stance heights here mirror genericStance() in mobility/generic.ts.

import type * as THREE from 'three';
import { Bld, type V3 } from './geo.ts';
import type { Kit } from './materials.ts';

export interface Gear {
  /** y of the hull underside */
  y0: number;
  /** y of the hull shoulder (track top / fender level) */
  yt: number;
  /** half width available to the lower hull between running gear */
  wi: number;
  tracked: boolean;
  update?: (t: number, moving: number) => void;
}

export function buildGear(parent: THREE.Group, mobId: string, L: number, W: number, S: number, kit: Kit, _legsOut: unknown[] = []): Gear {
  if (mobId === 'rotor' || mobId === 'gravlift' || mobId === 'jet') return { y0: 0, yt: 0.1, wi: W * 0.4, tracked: false };
  // plain skirt for anything else
  const b = new Bld();
  const hgt = 0.12 + 0.05 * S;
  const rings: V3[][] = [];
  for (const [x, wd, y] of [[-0.5, 0.78, 0.0], [-0.45, 0.94, 0.04], [0.42, 0.94, 0.04], [0.5, 0.7, 0.0]] as [number, number, number][]) {
    rings.push([[x * L, y, -wd * 0.9 * W / 2], [x * L, y + hgt, -wd * W / 2], [x * L, y + hgt, wd * W / 2], [x * L, y, wd * 0.9 * W / 2]]);
  }
  b.loft(kit.rubber, rings);
  b.mount(parent);
  return { y0: hgt * 0.9, yt: hgt * 1.4, wi: W * 0.4, tracked: false };
}
