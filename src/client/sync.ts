// Server-side copy of the player's garage (designs + active deck), stored with their player record in DATA_DIR.
// localStorage stays the working copy. Alongside it we keep the BASE: the garage as last agreed with the server (its
// rev + content). Local edits are whatever differs from the base, so nothing depends on a "dirty" flag that a
// concurrent write (another tab, an edit while a request is out) could clear. Every local write pushes the change
// (debounced). When the server has a newer rev, a clean local copy is replaced; edits on both sides are merged
// three-way against the base: a design deleted on one side stays deleted unless the other side edited it, a design
// edited on this side keeps this side's edits, and the deck follows whichever side changed it (this one if both did).
// Offline / server errors just leave the local edits for the next try.

import { NetError, currentSession, ensureSession, getGarage, putGarage, type GarageData } from './net.ts';
import { loadDeckIds, loadDesigns, replaceGarage, setGarageWriteHook } from './storage.ts';
import type { Design } from '../shared/types.ts';

const KEY = 'ab2.garageSync';
interface Garage { designs: Design[]; deck: string[] }
/** the garage as last synced: rev = server rev it matches, owner = player id it syncs to */
interface Base extends Garage { rev: number; owner: string }

/** The base for this owner, or null when this browser never synced with that account (older builds stored only
 *  {rev, dirty, owner}: no content, so everything local counts as unsynced and merges as a union). */
function loadBase(owner: string): Base | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Base> | null;
    if (s && s.owner === owner && typeof s.rev === 'number' && Array.isArray(s.designs) && Array.isArray(s.deck)) {
      return { owner, rev: s.rev, designs: s.designs.filter((d) => d && typeof d.id === 'string'), deck: s.deck.filter((x) => typeof x === 'string') };
    }
  } catch { /* storage unavailable / corrupt */ }
  return null;
}
function saveBase(b: Base): void {
  try { localStorage.setItem(KEY, JSON.stringify(b)); } catch { /* storage unavailable */ }
}

let timer: ReturnType<typeof setTimeout> | null = null;
let running: Promise<void> | null = null;
let again = false;

function local(): Garage {
  const d = loadDesigns(), k = loadDeckIds();
  return { designs: Array.isArray(d) ? d.filter((x) => x && typeof x.id === 'string') : [], deck: Array.isArray(k) ? k.filter((x) => typeof x === 'string') : [] };
}

/** Order-independent-of-key-order fingerprint of a design. */
function dkey(d: Design): string {
  const b = d.behavior && typeof d.behavior === 'object' ? Object.fromEntries(Object.entries(d.behavior).sort(([x], [y]) => (x < y ? -1 : 1))) : null;
  return JSON.stringify([d.id, d.name, d.chassis, d.mobility, d.mounts, b]);
}
const gkey = (g: Garage) => JSON.stringify([g.designs.map(dkey), g.deck]);
const same = (a: Garage, b: Garage) => gkey(a) === gkey(b);

/** Three-way merge of this device's garage and the server's against the last synced base (null = never synced:
 *  union, this device winning on the same id). Exported for tests. */
export function mergeGarage(base: Garage | null, mine: Garage, srv: Garage): Garage {
  const b = new Map((base?.designs ?? []).map((d) => [d.id, dkey(d)] as const));
  const l = new Map<string, Design>(), s = new Set<string>();
  for (const d of mine.designs) if (!l.has(d.id)) l.set(d.id, d);
  for (const d of srv.designs) s.add(d.id);
  const editedSinceBase = (d: Design) => b.get(d.id) !== dkey(d); // also true for designs new since the base
  const out: Design[] = [], seen = new Set<string>();
  const add = (d: Design) => { if (!seen.has(d.id)) { seen.add(d.id); out.push(d); } };
  for (const sd of srv.designs) {
    const ld = l.get(sd.id);
    if (ld) add(editedSinceBase(ld) ? ld : sd);
    // missing here: deleted on this device (drop it) unless the server edited it since (or it is new there)
    else if (editedSinceBase(sd)) add(sd);
  }
  // only here: new on this device, or deleted on the server and not edited here since
  for (const ld of l.values()) if (!s.has(ld.id) && editedSinceBase(ld)) add(ld);
  const ids = new Set(out.map((d) => d.id));
  const keep = (deck: string[]) => deck.filter((id, i) => ids.has(id) && deck.indexOf(id) === i);
  const mineDeck = keep(mine.deck), srvDeck = keep(srv.deck);
  const mineChanged = !base || JSON.stringify(base.deck) !== JSON.stringify(mine.deck);
  return { designs: out, deck: (mineChanged && mineDeck.length) || !srvDeck.length ? mineDeck : srvDeck };
}

async function syncOnce(): Promise<void> {
  const owner = (await ensureSession()).playerId;
  let srv: GarageData | null = await getGarage();
  for (let tries = 0; tries < 3; tries++) {
    // read base + local only now (after the await): edits made while the request was out must count
    let base = loadBase(owner);
    let mine = local();
    if (srv && srv.rev !== base?.rev) {
      const theirs: Base = { owner, rev: srv.rev, designs: srv.designs, deck: srv.deck };
      if (!mine.designs.length || (base && same(base, mine))) {
        // no local edits (or no local garage at all): take the server copy as is
        replaceGarage(srv.designs, srv.deck);
        saveBase(theirs);
        return;
      }
      const merged = mergeGarage(base, mine, srv);
      if (!same(merged, mine)) replaceGarage(merged.designs, merged.deck);
      saveBase(theirs);
      base = theirs;
      mine = merged;
    }
    if (base && same(base, mine)) return; // nothing to push
    if (!mine.designs.length) return; // nothing to store yet (collection.ts seeds the starters on first read)
    const r = await putGarage(mine.designs, mine.deck, base?.rev ?? 0);
    // the base is what was SENT: writes made while the request was out still differ from it and get pushed next
    if (r.ok) { saveBase({ owner, rev: r.rev, designs: mine.designs, deck: mine.deck }); return; }
    srv = r.conflict;
  }
}

/** Pull/push now. Resolves when done (never rejects: failures leave the local edits for the next try). */
export function syncGarage(): Promise<void> {
  // already syncing: run once more afterwards (edits / a sign-in since it started) and resolve after that run
  if (running) { again = true; return running.then(() => running ?? undefined); }
  running = syncOnce()
    // a token the server no longer knows (data reset) was just cleared by net.ts: sync again under a fresh account
    .catch((e) => (e instanceof NetError && e.status === 401 ? syncOnce() : undefined))
    .catch(() => { /* offline or server unavailable: retried on the next write / start */ })
    .finally(() => { running = null; if (again) { again = false; void syncGarage(); } });
  return running;
}

/** Start syncing: push local writes shortly after they happen, and pull/push once now. */
export function startGarageSync(): Promise<void> {
  setGarageWriteHook(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void syncGarage(); }, 1200);
  });
  window.addEventListener('pagehide', () => { if (timer && currentSession()) { clearTimeout(timer); timer = null; void syncGarage(); } });
  return syncGarage();
}
