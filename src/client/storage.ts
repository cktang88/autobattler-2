// Local persistence of the player's garage (designs) and active deck.

import type { Design, MatchState } from '../shared/types.ts';
import { sanitizePool, type AiPool } from '../shared/aipool.ts';

const KEY_DESIGNS = 'ab2.designs';
const KEY_DECK = 'ab2.deck';
const KEY_SETTINGS = 'ab2.settings';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage unavailable */ }
}

/** called after every local garage write (sync.ts pushes the change to the server) */
let onGarageWrite: (() => void) | null = null;
export const setGarageWriteHook = (fn: (() => void) | null) => { onGarageWrite = fn; };

export const loadDesigns = (): Design[] | null => read<Design[] | null>(KEY_DESIGNS, null);
export const saveDesigns = (d: Design[]) => { write(KEY_DESIGNS, d); onGarageWrite?.(); };
/** ids of designs in the active deck (max DECK_SIZE) */
export const loadDeckIds = (): string[] | null => read<string[] | null>(KEY_DECK, null);
export const saveDeckIds = (ids: string[]) => { write(KEY_DECK, ids); onGarageWrite?.(); };
/** replace the local garage with a server copy (no write hook: this IS the synced state) */
export const replaceGarage = (designs: Design[], deck: string[]) => { write(KEY_DESIGNS, designs); write(KEY_DECK, deck); };

export interface Settings {
  master: number; music: number; sfx: number; battleSpeed: number;
  /** 0..1 camera shake multiplier (accessibility) */
  shake: number;
  /** 0..1 full-screen flash multiplier (photosensitivity) */
  flashes: number;
  /** show unit health bars at all times instead of only after damage */
  alwaysHealth: boolean;
  /** slight camera tilt (2.5D look) on the battlefield; off = classic straight-down view */
  tilt: boolean;
  /** battle replay camera follows the fight (frames every living unit, zooms in as it thins out) until moved */
  autoCam: boolean;
  /** battlefield renderer: classic 2D canvas art or the three.js 3D view */
  renderer: '2d' | '3d';
  /** 3D view: detailed unit surface textures (plate seams, wear, grime); off = plain paint (faster on weak GPUs) */
  unitTextures?: boolean;
  /** 3D view: sun shadow maps from units, wrecks and props; off = soft contact blobs only (faster) */
  shadows?: boolean;
  /** the player picked the renderer in Settings; until then the default (3D) applies, even over older saves that
   *  stored the then-default '2d' */
  rendererChosen?: boolean;
  /** open the detailed round stats popup after every battle (it can always be opened from the result banner) */
  roundStats?: boolean;
}
/** replay speeds offered in battle and settings (slow-mo included) */
export const BATTLE_SPEEDS = [0.25, 0.5, 1, 2, 4];
export const speedLabel = (v: number) => (v === 0.25 ? '¼×' : v === 0.5 ? '½×' : `${v}×`);
export const defaultSettings: Settings = { master: 0.8, music: 0.5, sfx: 0.8, battleSpeed: 1, shake: 1, flashes: 1, alwaysHealth: false, tilt: true, autoCam: true, renderer: '3d' };

/** Apply the visual accessibility settings to a FieldView-like object. */
export function applyViewSettings(view: { shakeScale?: number; flashScale?: number; alwaysShowHealth?: boolean; setTilt?: (on: boolean) => void; setUnitTextures?: (on: boolean) => void; setShadows?: (on: boolean) => void }, s: Settings = loadSettings()): void {
  view.shakeScale = s.shake;
  view.flashScale = s.flashes;
  view.alwaysShowHealth = s.alwaysHealth;
  view.setTilt?.(s.tilt !== false);
  view.setUnitTextures?.(s.unitTextures !== false);
  view.setShadows?.(s.shadows !== false);
}
/** Saved settings from any earlier build (or hand-edited storage): every field is type-checked and falls back to its
 *  default, so a stale or corrupt value (a string volume, an unknown renderer, a non-object) can't reach the UI. */
export const loadSettings = (): Settings => {
  const raw = read<unknown>(KEY_SETTINGS, {});
  const o = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const s: Settings = { ...defaultSettings };
  const unit = (k: 'master' | 'music' | 'sfx' | 'shake' | 'flashes') => {
    const v = o[k];
    if (typeof v === 'number' && Number.isFinite(v)) s[k] = Math.max(0, Math.min(1, v));
  };
  unit('master'); unit('music'); unit('sfx'); unit('shake'); unit('flashes');
  if (typeof o.battleSpeed === 'number' && BATTLE_SPEEDS.includes(o.battleSpeed)) s.battleSpeed = o.battleSpeed;
  for (const k of ['alwaysHealth', 'tilt', 'autoCam', 'unitTextures', 'shadows', 'rendererChosen', 'roundStats'] as const) {
    if (typeof o[k] === 'boolean') s[k] = o[k] as boolean;
  }
  if (s.rendererChosen && (o.renderer === '2d' || o.renderer === '3d')) s.renderer = o.renderer;
  return s;
};
export const saveSettings = (s: Settings) => write(KEY_SETTINGS, s);

// ---- cached copy of the server's global AI design pool (shared/aipool.ts) ----
// Only a cache: the pool lives on the server. A per-browser v1 pool from before is discarded by sanitizePool
// (wrong version -> the curated default) and overwritten by the next fetch.
const KEY_AI_POOL = 'ab2.aiPool';
const KEY_AI_REPORTS = 'ab2.aiReports';
/** The cached AI pool, validated (missing / corrupt / old-version data falls back to the curated default). */
export const loadAiPool = (): AiPool => sanitizePool(read<unknown>(KEY_AI_POOL, null));
export const saveAiPool = (p: AiPool) => write(KEY_AI_POOL, p);
/** Finished vs-AI matches whose report has not reached the server yet (oldest first, at most 3 kept). */
export const loadPendingReports = (): MatchState[] => { const r = read<unknown>(KEY_AI_REPORTS, []); return Array.isArray(r) ? (r as MatchState[]).slice(-3) : []; };
export const savePendingReports = (r: MatchState[]) => write(KEY_AI_REPORTS, r.slice(-3));
