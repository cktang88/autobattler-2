// Input sanitizers: rebuild request payloads from known fields only, with strict type/size checks,
// before handing them to the shared match rules.

import { DECK_SIZE, validateDeck } from '../shared/match.ts';
import { validateDesign } from '../shared/stats.ts';
import type { DeployAction, Design, Placement } from '../shared/types.ts';

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const bad = (msg: string): never => { throw new HttpError(400, msg); };
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const str = (v: unknown, max: number, what: string): string => {
  if (typeof v !== 'string' || v.length === 0 || v.length > max) bad(`Invalid ${what}`);
  return v as string;
};

export function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') bad('Name required');
  const name = (raw as string)
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N} _.\-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if ([...name].length < 2 || [...name].length > 16) bad('Callsign must be 2-16 letters, digits, spaces or _.-');
  return name;
}

export function sanitizeDeck(raw: unknown): Design[] {
  if (!Array.isArray(raw) || raw.length === 0) bad('Deck must be a non-empty array of designs');
  const arr = raw as unknown[];
  if (arr.length > DECK_SIZE) bad(`Deck may hold at most ${DECK_SIZE} designs`);
  const seen = new Set<string>();
  const deck = arr.map((d, i): Design => {
    if (!isObj(d)) bad(`Design ${i + 1} is not an object`);
    const o = d as Record<string, unknown>;
    const id = str(o.id, 40, `design id (#${i + 1})`);
    if (seen.has(id)) bad(`Duplicate design id ${id}`);
    seen.add(id);
    if (typeof o.name !== 'string' || o.name.length > 24) bad(`Invalid design name (#${i + 1})`);
    if (!Array.isArray(o.mounts) || o.mounts.length > 8) bad(`Invalid mounts (#${i + 1})`);
    const mounts = (o.mounts as unknown[]).map((m) => {
      if (m === null) return null;
      return str(m, 40, `mount (#${i + 1})`);
    });
    return { id, name: o.name as string, chassis: str(o.chassis, 40, 'chassis'), mobility: str(o.mobility, 40, 'mobility'), mounts };
  });
  for (const d of deck) {
    const errs = validateDesign(d);
    if (errs.length) bad(`${d.name || d.id}: ${errs.join(', ')}`);
  }
  const errs = validateDeck(deck);
  if (errs.length) bad(errs.join('; '));
  return deck;
}

export function sanitizeAction(raw: unknown): DeployAction {
  if (!isObj(raw)) bad('action required');
  const a = raw as Record<string, unknown>;
  if (!isInt(a.round)) bad('action.round must be an integer');
  const placeRaw = a.place ?? [];
  const upRaw = a.upgrade ?? [];
  if (!Array.isArray(placeRaw) || placeRaw.length > 64) bad('action.place must be an array (max 64)');
  if (!Array.isArray(upRaw) || upRaw.length > 64) bad('action.upgrade must be an array (max 64)');
  const place = (placeRaw as unknown[]).map((p): Placement => {
    if (!isObj(p)) bad('placement must be an object');
    const o = p as Record<string, unknown>;
    for (const k of ['uid', 'x', 'y', 'level', 'round'] as const) {
      if (!isInt(o[k]) || Math.abs(o[k] as number) > 1e6) bad(`placement.${k} must be an integer`);
    }
    const pl: Placement = {
      uid: o.uid as number, designId: str(o.designId, 40, 'placement.designId'),
      x: o.x as number, y: o.y as number, level: o.level as number, round: o.round as number,
    };
    if (o.spacing !== undefined) {
      if (!isInt(o.spacing) || (o.spacing as number) < 0 || (o.spacing as number) > 8) bad('placement.spacing must be a small integer');
      pl.spacing = o.spacing as number;
    }
    return pl;
  });
  const upgrade = (upRaw as unknown[]).map((u) => {
    if (!isInt(u) || Math.abs(u) > 1e6) bad('upgrade entries must be unit uids');
    return u as number;
  });
  return { round: a.round as number, place, upgrade };
}
