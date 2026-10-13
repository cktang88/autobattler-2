// STUB — garage agent implements. The player's saved designs and active deck (seeded with starter designs).

import type { Design } from '../shared/types.ts';

/** All saved designs (seeded with starters on first run). */
export function allDesigns(): Design[] { return []; }
/** The active deck: up to DECK_SIZE valid designs. Never empty (falls back to starters). */
export function activeDeck(): Design[] { return []; }
