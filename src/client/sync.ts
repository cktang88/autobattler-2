// Server-side copy of the player's garage (designs + active deck), stored with their player record in DATA_DIR.
// localStorage stays the working copy; every local write marks it dirty and pushes it (debounced). On startup the
// server copy is pulled: a newer server rev replaces a clean local copy, and edits on both sides merge (union of
// designs by id, this device's deck). Offline / server errors just leave the local copy dirty for the next try.

import { NetError, currentSession, ensureSession, getGarage, putGarage, type GarageData } from './net.ts';
import { loadDeckIds, loadDesigns, replaceGarage, setGarageWriteHook } from './storage.ts';
import type { Design } from '../shared/types.ts';

const KEY = 'ab2.garageSync';
/** rev = server rev this copy matches, dirty = local edits not on the server yet, owner = player id it syncs to */
interface SyncState { rev: number; dirty: boolean; owner: string }

function state(): SyncState {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as SyncState | null;
    if (s && typeof s.rev === 'number' && typeof s.owner === 'string') return { rev: s.rev, dirty: !!s.dirty, owner: s.owner };
  } catch { /* storage unavailable */ }
  // never synced: whatever is in this browser is unsaved work
  return { rev: 0, dirty: true, owner: '' };
}
function setState(s: SyncState): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}

let timer: ReturnType<typeof setTimeout> | null = null;
let running: Promise<void> | null = null;
let again = false;

function local(): { designs: Design[]; deck: string[] } {
  const d = loadDesigns(), k = loadDeckIds();
  return { designs: Array.isArray(d) ? d : [], deck: Array.isArray(k) ? k : [] };
}

function merge(srv: GarageData): void {
  const mine = local();
  const ids = new Set(srv.designs.map((d) => d.id));
  replaceGarage([...srv.designs, ...mine.designs.filter((d) => d && !ids.has(d.id))], mine.deck.length ? mine.deck : srv.deck);
}

async function syncOnce(): Promise<void> {
  const session = await ensureSession();
  let s = state();
  if (s.owner !== session.playerId) s = { rev: 0, dirty: true, owner: session.playerId };
  const srv = await getGarage();
  if (srv && srv.rev !== s.rev) {
    if (s.dirty) merge(srv);
    else { replaceGarage(srv.designs, srv.deck); setState({ rev: srv.rev, dirty: false, owner: session.playerId }); return; }
    s.rev = srv.rev;
  }
  if (!s.dirty && srv) { setState(s); return; }
  for (let tries = 0; tries < 3; tries++) {
    const g = local();
    if (!g.designs.length) break; // nothing to store yet (collection.ts seeds the starters on first read)
    const r = await putGarage(g.designs, g.deck, s.rev);
    if (r.ok) { setState({ rev: r.rev, dirty: false, owner: session.playerId }); return; }
    merge(r.conflict);
    s.rev = r.conflict.rev;
  }
  setState({ ...s, dirty: true });
}

/** Pull/push now. Resolves when done (never rejects: failures leave the local copy dirty). */
export function syncGarage(): Promise<void> {
  if (running) { again = true; return running; }
  running = syncOnce()
    // a token the server no longer knows (data reset) was just cleared by net.ts: sync again under a fresh account
    .catch((e) => (e instanceof NetError && e.status === 401 ? syncOnce() : undefined))
    .catch(() => { /* offline or server unavailable: retried on the next write / start */ })
    .finally(() => { running = null; if (again) { again = false; void syncGarage(); } });
  return running;
}

/** Start syncing: mark local writes dirty + push them shortly after, and pull/push once now. */
export function startGarageSync(): Promise<void> {
  setGarageWriteHook(() => {
    const s = state();
    setState({ ...s, dirty: true });
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void syncGarage(); }, 1200);
  });
  window.addEventListener('pagehide', () => { if (timer && currentSession()) { clearTimeout(timer); timer = null; void syncGarage(); } });
  return syncGarage();
}
