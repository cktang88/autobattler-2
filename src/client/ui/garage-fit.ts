// Garage refit rules (pure: no DOM, testable in node): re-seating a loadout on another hull, and the hull a unit-class
// switch lands on.

import { slotError } from '../../shared/stats.ts';
import { meleeSlots } from '../../shared/mountgeo.ts';
import { CHASSIS, MOBILITY, MOBILITY_BY_ID, MODULE_BY_ID, MOUNT_RANK, chassisDomain, pairingError } from '../../shared/parts.ts';
import type { ChassisDef, Design, Domain, ModuleDef } from '../../shared/types.ts';

export const firstLegalMobility = (chassisId: string) => MOBILITY.find((m) => !pairingError(chassisId, m.id))?.id ?? MOBILITY[0].id;

/** why a module can't be mounted with this mobility (null = fine) */
export function reqReason(mod: { requires?: 'air' | 'ground' }, mobility: string): string | null {
  if (!mod.requires) return null;
  const flies = MOBILITY_BY_ID.get(mobility)?.kind === 'air';
  if (mod.requires === 'air' && !flies) return 'Flying designs only';
  if (mod.requires === 'ground' && flies) return 'Ground designs only';
  return null;
}

const isMelee = (m: ModuleDef) => m.category === 'melee';

/** Re-seat modules onto a new chassis: biggest modules first (melee before others of its size, as it can only use edge
 *  sockets), each into the smallest free socket that legally takes it; other parts keep off edge sockets while a plain
 *  one of the same size is free, so they don't take the only place a blade fits. Parts that fit nowhere are dropped. */
export function reseat(mods: (string | null)[], c: ChassisDef, mobility: string): (string | null)[] {
  const out: (string | null)[] = c.mounts.map(() => null);
  const edge = meleeSlots(c);
  const list = mods.filter((m): m is string => !!m && MODULE_BY_ID.has(m))
    .map((id) => MODULE_BY_ID.get(id)!)
    .sort((a, b) => MOUNT_RANK[b.mount] - MOUNT_RANK[a.mount] || Number(isMelee(b)) - Number(isMelee(a)));
  for (const mod of list) {
    const slots = c.mounts.map((cls, i) => ({ cls, i }))
      .filter((s) => out[s.i] === null && !slotError(c, mobility, s.i, mod))
      .sort((a, b) => MOUNT_RANK[a.cls] - MOUNT_RANK[b.cls] || (isMelee(mod) ? 0 : Number(edge[a.i]) - Number(edge[b.i])));
    if (slots.length) out[slots[0].i] = mod.id;
  }
  return out;
}

/** The design a unit-class switch produces: the class's hull that keeps the most of the current loadout (parts that
 *  need the other class's drive, such as bomb bays or melee, are dropped), then the one nearest the current hull's
 *  size, then the smallest and lightest; its first legal drive. null when the class has no hulls. */
export function refitForClass(d: Design, dom: Domain): Design | null {
  const cur = CHASSIS.find((c) => c.id === d.chassis);
  const size = cur?.size ?? 1;
  let best: { d: Design; kept: number; c: ChassisDef } | null = null;
  for (const c of CHASSIS) {
    if (chassisDomain(c) !== dom) continue;
    const mobility = firstLegalMobility(c.id);
    const usable = d.mounts.map((id) => (id && !reqReason(MODULE_BY_ID.get(id) ?? {}, mobility) ? id : null));
    const mounts = reseat(usable, c, mobility);
    const kept = mounts.filter(Boolean).length;
    const better = !best || kept > best.kept || (kept === best.kept && (
      Math.abs(c.size - size) - Math.abs(best.c.size - size) || c.size - best.c.size || c.weight - best.c.weight) < 0);
    if (better) best = { d: { ...d, chassis: c.id, mobility, mounts }, kept, c };
  }
  return best?.d ?? null;
}
