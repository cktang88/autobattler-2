// STUB — server agent implements. Client side of async multiplayer.

import type { Design, MatchState, Side } from '../shared/types.ts';
import type { MatchDriver } from './driver.ts';

export interface Session { playerId: string; name: string; token: string }
export interface MatchSummary {
  id: string;
  status: MatchState['status'];
  round: number;
  /** names [p0, p1?] */
  names: [string, string | null];
  hp: [number, number];
  /** for 'mine': my side, and whether the server is waiting on me */
  side?: Side;
  yourTurn?: boolean;
  updatedAt: number;
}

export function currentSession(): Session | null { return null; }
export async function login(name: string): Promise<Session> { throw new Error('stub'); }
export function logout(): void {}
export async function listMatches(): Promise<{ mine: MatchSummary[]; open: MatchSummary[] }> { return { mine: [], open: [] }; }
export async function createMatch(deck: Design[]): Promise<string> { throw new Error('stub'); }
export async function joinMatch(id: string, deck: Design[]): Promise<void> { throw new Error('stub'); }
/** Load a match the current player is in and return a driver for it. */
export async function openMatch(id: string): Promise<MatchDriver> { throw new Error('stub'); }
