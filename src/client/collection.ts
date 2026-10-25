// The player's saved designs ("garage") and active deck, persisted in localStorage.
// Seeded with STARTER_DESIGNS on first run (or whenever storage is empty).

import { DECK_SIZE } from '../shared/match.ts';
import { STARTER_DESIGNS } from '../shared/starters.ts';
import { MAX_LOAD, computeStats, dropExtraWeapons, replaceRetiredModules, slotError, validateDesign } from '../shared/stats.ts';
import { CHASSIS_BY_ID, MOBILITY_BY_ID, MODULE_BY_ID, pairingError } from '../shared/parts.ts';
import type { Design } from '../shared/types.ts';
import { loadDeckIds, loadDesigns, saveDeckIds, saveDesigns } from './storage.ts';
import { firstLegalMobility } from './ui/garage-fit.ts';

const clone = (d: Design): Design => ({
  id: d.id, name: d.name, chassis: d.chassis, mobility: d.mobility, mounts: [...d.mounts],
  ...(d.behavior && typeof d.behavior === 'object' ? { behavior: { ...d.behavior } } : {}),
  ...(typeof d.editedAt === 'number' && Number.isFinite(d.editedAt) ? { editedAt: d.editedAt } : {}),
});

/** Shape check + full rule validation. Corrupt or illegal entries are dropped. */
function sane(d: unknown): d is Design {
  if (!d || typeof d !== 'object') return false;
  const x = d as Design;
  if (typeof x.id !== 'string' || typeof x.name !== 'string' || typeof x.chassis !== 'string' || typeof x.mobility !== 'string') return false;
  if (!Array.isArray(x.mounts) || !x.mounts.every((m) => m === null || typeof m === 'string')) return false;
  try {
    return validateDesign(x).length === 0;
  } catch {
    return false;
  }
}

const NAME_MAX = 24;
/** Make a saved design legal again after a rules change instead of dropping it (dropping is permanent: the cleaned list
 *  is written back and synced). Keeps the id, name and orders; a drive the hull no longer takes becomes its first
 *  legal one; unknown parts and parts that no longer fit their socket move to a free socket that takes them, else go
 *  back to stores; an overloaded design sheds its heaviest parts. null when the entry is not a design at all (no id,
 *  unknown hull) or nothing armed is left. Exported for tests. */
export function repairDesign(raw: unknown): Design | null {
  if (!raw || typeof raw !== 'object') return null;
  const x = raw as Partial<Design>;
  if (typeof x.id !== 'string' || !x.id || x.id.length > 40) return null;
  const c = typeof x.chassis === 'string' ? CHASSIS_BY_ID.get(x.chassis) : undefined;
  if (!c) return null;
  const name = (typeof x.name === 'string' ? x.name.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim() : '') || 'Untitled';
  const mobility = typeof x.mobility === 'string' && !pairingError(c.id, x.mobility) && !MOBILITY_BY_ID.get(x.mobility)?.retired ? x.mobility : firstLegalMobility(c.id);
  const mounts: (string | null)[] = c.mounts.map(() => null);
  const left: string[] = [];
  (Array.isArray(x.mounts) ? x.mounts : []).forEach((id, i) => {
    const mod = typeof id === 'string' ? MODULE_BY_ID.get(id) : undefined;
    if (!mod) return;
    if (i < mounts.length && !slotError(c, mobility, i, mod)) mounts[i] = mod.id;
    else left.push(mod.id);
  });
  for (const id of left) {
    const mod = MODULE_BY_ID.get(id)!;
    const i = mounts.findIndex((m, k) => m === null && !slotError(c, mobility, k, mod));
    if (i >= 0) mounts[i] = id;
  }
  const d: Design = {
    id: x.id, name, chassis: c.id, mobility, mounts,
    ...(x.behavior && typeof x.behavior === 'object' ? { behavior: { ...x.behavior } } : {}),
    ...(typeof x.editedAt === 'number' && Number.isFinite(x.editedAt) ? { editedAt: x.editedAt } : {}),
  };
  replaceRetiredModules(d); // retired parts (rules 7: Autoloader, Gyro) swap for their replacement
  dropExtraWeapons(d); // over the hull's weapon cap (rules 7): the weakest extra weapons go back to stores
  const overloaded = () => { try { return computeStats(d).load > MAX_LOAD; } catch { return false; } };
  while (overloaded()) {
    let k = -1;
    d.mounts.forEach((m, i) => { if (m && (k < 0 || MODULE_BY_ID.get(m)!.weight > MODULE_BY_ID.get(d.mounts[k]!)!.weight)) k = i; });
    if (k < 0) break;
    d.mounts[k] = null;
  }
  return sane(d) ? d : null;
}

/** Starter designs are read-only templates in the player's collection, shown as "Name (Standard)". Saving an edit
 *  of one creates the player's own copy (new id, no suffix) and leaves the standard as it is. */
export const STANDARD_SUFFIX = ' (Standard)';
const STARTER_BY_ID = new Map(STARTER_DESIGNS.map((d) => [d.id, d] as const));
export const isStandard = (d: Pick<Design, 'id'>) => STARTER_BY_ID.has(d.id);
const standardCopy = (s: Design): Design => ({ ...clone(s), name: s.name + STANDARD_SUFFIX });
export const stripStandard = (name: string) => name.replace(/\s*\(Standard\)/gi, '').replace(/\s+/g, ' ').trim() || name;
/** the player's own copy of an edited standard: a stable id (the same on every device for the same edit) */
const forkId = (d: Design) => `my-${d.id.replace(/^starter-/, '')}-${Math.round(d.editedAt ?? Date.now()).toString(36)}`;

function seed(): Design[] {
  const out = STARTER_DESIGNS.filter(sane).map(standardCopy);
  if (out.length) saveDesigns(out);
  return out;
}

/** All saved designs (seeded with starters on first run or when storage is empty). Always fresh copies. */
export function allDesigns(): Design[] {
  const raw = loadDesigns();
  if (!Array.isArray(raw) || raw.length === 0) return seed();
  const seen = new Set<string>();
  const out: Design[] = [];
  let changed = false;
  const deckMap = new Map<string, string>();
  for (const entry of raw) {
    let d = entry as Design;
    if (!sane(d)) {
      // illegal under the current rules (or hand-edited): repair what can be kept rather than delete it
      changed = true;
      const fixed = repairDesign(entry);
      if (!fixed) continue;
      d = fixed;
    }
    if (seen.has(d.id)) { changed = true; continue; }
    seen.add(d.id);
    const st = STARTER_BY_ID.get(d.id);
    if (st && d.editedAt != null) {
      // an edited standard (saved before standards became read-only): it's the player's own design now; the
      // pristine standard comes back next to it
      const mine = { ...clone(d), id: forkId(d), name: stripStandard(d.name) };
      out.push(mine);
      deckMap.set(d.id, mine.id);
      if (sane(st)) out.push(standardCopy(st));
      changed = true;
    } else if (st) {
      // untouched standards follow the current template (name suffix, balance updates to the starter itself)
      const fresh = standardCopy(st);
      if (JSON.stringify(fresh) !== JSON.stringify(clone(d))) { if (sane(fresh)) { out.push(fresh); changed = true; } else out.push(clone(d)); }
      else out.push(clone(d));
    } else out.push(clone(d));
  }
  if (out.length === 0) return seed();
  const dedup = out.filter((d, i) => out.findIndex((x) => x.id === d.id) === i);
  if (changed || dedup.length !== out.length) saveDesigns(dedup);
  if (deckMap.size) { const ids = loadDeckIds(); if (ids) saveDeckIds(ids.map((x) => deckMap.get(x) ?? x)); }
  return dedup;
}

export function getDesign(id: string): Design | undefined {
  return allDesigns().find((d) => d.id === id);
}

/** Insert or replace (by id). Returns the id it was saved under (a standard is saved as the player's own copy with
 *  a new id, taking the standard's place in the deck), or null (and saves nothing) when the design is illegal. */
export function saveDesign(d: Design): string | null {
  if (!sane(d)) return null;
  const list = allDesigns();
  const editedAt = Date.now();
  let saved: Design = { ...clone(d), editedAt };
  if (isStandard(d)) {
    saved = { ...saved, id: forkId(saved), name: stripStandard(d.name) };
    const ids = loadDeckIds();
    if (ids?.includes(d.id)) saveDeckIds(ids.map((x) => (x === d.id ? saved.id : x)));
  }
  const i = list.findIndex((x) => x.id === saved.id);
  if (i >= 0) list[i] = saved;
  else list.push(saved);
  saveDesigns(list);
  return saved.id;
}

/** Remove a design (and drop it from the deck). */
export function deleteDesign(id: string): void {
  saveDesigns(allDesigns().filter((d) => d.id !== id));
  const ids = loadDeckIds();
  if (ids) saveDeckIds(ids.filter((x) => x !== id));
}

/** Set the active deck. Unknown/duplicate ids are dropped; capped at DECK_SIZE. */
export function setDeck(ids: string[]): void {
  const known = new Set(allDesigns().map((d) => d.id));
  const out: string[] = [];
  for (const id of ids) if (known.has(id) && !out.includes(id) && out.length < DECK_SIZE) out.push(id);
  saveDeckIds(out);
}

/** The active deck: up to DECK_SIZE valid designs. Never empty while any valid design exists. */
export function activeDeck(): Design[] {
  const all = allDesigns();
  const byId = new Map(all.map((d) => [d.id, d] as const));
  const ids = loadDeckIds();
  const deck: Design[] = [];
  if (Array.isArray(ids)) {
    for (const id of ids) {
      const d = typeof id === 'string' ? byId.get(id) : undefined;
      if (d && !deck.includes(d) && deck.length < DECK_SIZE) deck.push(d);
    }
  }
  if (deck.length) return deck;
  // Fallback: starters present in the collection first, then any other designs.
  const starterIds = new Set(STARTER_DESIGNS.map((d) => d.id));
  const ordered = [...all.filter((d) => starterIds.has(d.id)), ...all.filter((d) => !starterIds.has(d.id))];
  if (ordered.length) return ordered.slice(0, DECK_SIZE);
  return STARTER_DESIGNS.filter(sane).slice(0, DECK_SIZE).map(clone);
}

/** Ids of the active deck (what the garage shows as "in deck"). */
export function deckIds(): string[] {
  return activeDeck().map((d) => d.id);
}

/** A fresh unique design id (<= 40 chars). */
export function newDesignId(): string {
  const existing = new Set((loadDesigns() ?? []).map((d) => d?.id));
  let id: string;
  do id = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  while (existing.has(id));
  return id;
}

