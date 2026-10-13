// STUB — render/audio agent implements. Keep the exported API.

import type { BattleEvent } from '../shared/sim/types.ts';

export type SfxName = 'click' | 'hover' | 'place' | 'invalid' | 'upgrade' | 'ready' | 'roundWin' | 'roundLose' | 'victory' | 'defeat' | 'error';
export type MusicTrack = 'menu' | 'deploy' | 'battle' | 'victory' | 'defeat' | null;

/** Call from a user gesture to unlock WebAudio. Safe to call repeatedly. */
export function unlockAudio(): void {}
export function sfx(name: SfxName): void {}
/** Play sounds for a tick's battle events (positional pan from x in world cells, 0..FIELD_W). */
export function battleSfx(events: BattleEvent[]): void {}
export function playMusic(track: MusicTrack): void {}
export function setVolumes(v: { master: number; music: number; sfx: number }): void {}
