// Torso helpers for hulls whose whole weapon system twists on the body (registerTorso): which design slot is the hero
// and which slots ride the torso as pods (units3d order), and a slot-keyed hardpoint table -> ChassisOut.torso's hp list.

import { MODULE_BY_ID } from '../../../shared/parts.ts';
import type { V3 } from '../geo.ts';
import type { ChassisCtx } from './registry.ts';

export interface TorsoSlots {
  /** design slot of the hero weapon (-1: no torso, e.g. utilities only) */
  hero: number;
  /** design slots of the pods, in units3d pod order (hp[1..]) */
  pods: number[];
  /** slot i carries a weapon on the torso (hero or pod) */
  armed: (i: number) => boolean;
}

/** In torso mode units3d hands the chassis only the hero (+ utilities) in c.mounts; every other weapon rides the torso
 *  as a pod in design-slot order (max 6). Reconstruct that mapping so the torso can build a sponson per armed slot. */
export function torsoSlots(c: ChassisCtx): TorsoSlots {
  const ws = c.mounts.filter((m) => m.mod.kind === 'weapon');
  const hero = ws.length === 1 ? ws[0].i : -1;
  const pods: number[] = [];
  if (hero >= 0) c.design.mounts.forEach((id, i) => {
    const m = id ? MODULE_BY_ID.get(id) : undefined;
    if (m && m.kind === 'weapon' && i !== hero && pods.length < 6) pods.push(i);
  });
  return { hero, pods, armed: (i) => i === hero || pods.includes(i) };
}

/** hp list for ChassisOut.torso: the hero's trunnion (its pitch pivot: base + a typical pitch offset for its radius)
 *  then each pod's base, from per-slot base points */
export function torsoHP(ts: TorsoSlots, base: (i: number) => V3, heroR: number): V3[] {
  const h = base(ts.hero);
  return [[h[0] + 0.19 * heroR, h[1] + 0.46 * heroR, h[2]], ...ts.pods.map(base)];
}
