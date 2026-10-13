// Local persistence of the player's garage (designs) and active deck.

import type { Design } from '../shared/types.ts';

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

export const loadDesigns = (): Design[] | null => read<Design[] | null>(KEY_DESIGNS, null);
export const saveDesigns = (d: Design[]) => write(KEY_DESIGNS, d);
/** ids of designs in the active deck (max DECK_SIZE) */
export const loadDeckIds = (): string[] | null => read<string[] | null>(KEY_DECK, null);
export const saveDeckIds = (ids: string[]) => write(KEY_DECK, ids);

export interface Settings {
  master: number; music: number; sfx: number; battleSpeed: number;
  /** 0..1 camera shake multiplier (accessibility) */
  shake: number;
  /** 0..1 full-screen flash multiplier (photosensitivity) */
  flashes: number;
  /** show unit health bars at all times instead of only after damage */
  alwaysHealth: boolean;
}
export const defaultSettings: Settings = { master: 0.8, music: 0.5, sfx: 0.8, battleSpeed: 1, shake: 1, flashes: 1, alwaysHealth: false };

/** Apply the visual accessibility settings to a FieldView-like object. */
export function applyViewSettings(view: { shakeScale?: number; flashScale?: number; alwaysShowHealth?: boolean }, s: Settings = loadSettings()): void {
  view.shakeScale = s.shake;
  view.flashScale = s.flashes;
  view.alwaysShowHealth = s.alwaysHealth;
}
export const loadSettings = (): Settings => ({ ...defaultSettings, ...read<Partial<Settings>>(KEY_SETTINGS, {}) });
export const saveSettings = (s: Settings) => write(KEY_SETTINGS, s);
