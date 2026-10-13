// The player's saved designs ("garage") and active deck, persisted in localStorage.
// Seeded with STARTER_DESIGNS on first run (or whenever storage is empty).

import { DECK_SIZE } from '../shared/match.ts';
import { STARTER_DESIGNS } from '../shared/starters.ts';
import { validateDesign } from '../shared/stats.ts';
import type { Design } from '../shared/types.ts';
import { loadDeckIds, loadDesigns, saveDeckIds, saveDesigns } from './storage.ts';

const clone = (d: Design): Design => ({ id: d.id, name: d.name, chassis: d.chassis, mobility: d.mobility, mounts: [...d.mounts], ...(d.behavior && typeof d.behavior === 'object' ? { behavior: { ...d.behavior } } : {}) });

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

function seed(): Design[] {
  const out = STARTER_DESIGNS.filter(sane).map(clone);
  if (out.length) saveDesigns(out);
  return out;
}

/** All saved designs (seeded with starters on first run or when storage is empty). Always fresh copies. */
export function allDesigns(): Design[] {
  const raw = loadDesigns();
  if (!Array.isArray(raw) || raw.length === 0) return seed();
  const seen = new Set<string>();
  const out: Design[] = [];
  for (const d of raw) {
    if (!sane(d) || seen.has(d.id)) continue;
    seen.add(d.id);
    out.push(clone(d));
  }
  if (out.length === 0) return seed();
  if (out.length !== raw.length) saveDesigns(out);
  return out;
}

export function getDesign(id: string): Design | undefined {
  return allDesigns().find((d) => d.id === id);
}

/** Insert or replace (by id). Returns false (and saves nothing) when the design is illegal. */
export function saveDesign(d: Design): boolean {
  if (!sane(d)) return false;
  const list = allDesigns();
  const i = list.findIndex((x) => x.id === d.id);
  if (i >= 0) list[i] = clone(d);
  else list.push(clone(d));
  saveDesigns(list);
  return true;
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

