// Input sanitizers: rebuild request payloads from known fields only, with strict type/size checks,
// before handing them to the shared match rules.

import { DECK_SIZE, validateDeck } from '../shared/match.ts';
import { validateDesign } from '../shared/stats.ts';
import { STANCES, START_DELAYS, TARGET_PRIORITIES } from '../shared/types.ts';
import type { DeployAction, Design, Placement, UnitBehavior, UnitConfig } from '../shared/types.ts';

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
/** Pick target/hold/kite/focus/stance/delay/retreat from a raw object (strictly typed), or bad() on invalid values. */
function readBehavior(o: Record<string, unknown>, what: string): UnitBehavior {
  const out: UnitBehavior = {};
  if (o.target !== undefined) {
    if (!TARGET_PRIORITIES.includes(o.target as never)) bad(`Invalid ${what}.target`);
    out.target = o.target as UnitBehavior['target'];
  }
  for (const k of ['hold', 'kite', 'focus', 'retreat'] as const) {
    if (o[k] !== undefined) {
      if (typeof o[k] !== 'boolean') bad(`Invalid ${what}.${k}`);
      out[k] = o[k] as boolean;
    }
  }
  if (o.stance !== undefined) {
    if (!STANCES.includes(o.stance as never)) bad(`Invalid ${what}.stance`);
    out.stance = o.stance as UnitBehavior['stance'];
  }
  if (o.delay !== undefined) {
    if (!(START_DELAYS as readonly unknown[]).includes(o.delay)) bad(`Invalid ${what}.delay`);
    out.delay = o.delay as number;
  }
  return out;
}
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
    const design = readDesign(d, i);
    if (seen.has(design.id)) bad(`Duplicate design id ${design.id}`);
    seen.add(design.id);
    return design;
  });
  for (const d of deck) {
    const errs = validateDesign(d);
    if (errs.length) bad(`${d.name || d.id}: ${errs.join(', ')}`);
  }
  const errs = validateDeck(deck);
  if (errs.length) bad(errs.join('; '));
  return deck;
}

/** Most designs one player's garage may hold on the server. */
export const MAX_GARAGE = 200;

/** A garage upload: designs are shape-checked (malformed = 400); designs the current rules reject are dropped
 *  (rule changes can invalidate old saves), as are duplicates and deck ids that name no kept design. */
export function sanitizeGarage(raw: unknown): { designs: Design[]; deck: string[] } {
  if (!isObj(raw)) bad('garage required');
  const g = raw as Record<string, unknown>;
  if (!Array.isArray(g.designs)) bad('designs must be an array');
  const arr = g.designs as unknown[];
  if (arr.length > MAX_GARAGE) bad(`A garage may hold at most ${MAX_GARAGE} designs`);
  const seen = new Set<string>();
  const designs: Design[] = [];
  arr.forEach((d, i) => {
    const design = readDesign(d, i);
    if (seen.has(design.id)) return;
    seen.add(design.id);
    let ok = false;
    try { ok = validateDesign(design).length === 0; } catch { ok = false; }
    if (ok) designs.push(design);
  });
  const deckRaw = g.deck ?? [];
  if (!Array.isArray(deckRaw) || deckRaw.length > DECK_SIZE * 2) bad('deck must be an array of design ids');
  const kept = new Set(designs.map((d) => d.id));
  const deck: string[] = [];
  for (const id of deckRaw as unknown[]) if (typeof id === 'string' && kept.has(id) && !deck.includes(id) && deck.length < DECK_SIZE) deck.push(id);
  return { designs, deck };
}

function readDesign(d: unknown, i: number): Design {
  if (!isObj(d)) bad(`Design ${i + 1} is not an object`);
  const o = d as Record<string, unknown>;
  const id = str(o.id, 40, `design id (#${i + 1})`);
  if (typeof o.name !== 'string' || o.name.length > 24) bad(`Invalid design name (#${i + 1})`);
  if (!Array.isArray(o.mounts) || o.mounts.length > 8) bad(`Invalid mounts (#${i + 1})`);
  const mounts = (o.mounts as unknown[]).map((m) => {
    if (m === null) return null;
    return str(m, 40, `mount (#${i + 1})`);
  });
  const design: Design = { id, name: o.name as string, chassis: str(o.chassis, 40, 'chassis'), mobility: str(o.mobility, 40, 'mobility'), mounts };
  if (o.behavior !== undefined) {
    if (!isObj(o.behavior)) bad(`Invalid behavior (#${i + 1})`);
    design.behavior = readBehavior(o.behavior as Record<string, unknown>, 'behavior');
    const km = (o.behavior as Record<string, unknown>).kiteMount;
    if (km !== undefined) {
      if (!isInt(km) || (km as number) < 0 || (km as number) > 16) bad('Invalid behavior.kiteMount');
      design.behavior.kiteMount = km as number;
    }
  }
  return design;
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
    if (o.rot !== undefined) {
      if (typeof o.rot !== 'boolean') bad('placement.rot must be a boolean');
      if (o.rot) pl.rot = true;
    }
    Object.assign(pl, readBehavior(o, 'placement'));
    if (o.kiteMount !== undefined) {
      if (!isInt(o.kiteMount) || (o.kiteMount as number) < 0 || (o.kiteMount as number) > 16) bad('placement.kiteMount must be a mount index');
      pl.kiteMount = o.kiteMount as number;
    }
    if (o.escort !== undefined) {
      if (!isInt(o.escort) || Math.abs(o.escort as number) > 1e6) bad('placement.escort must be a unit uid');
      pl.escort = o.escort as number;
    }
    return pl;
  });
  const upgrade = (upRaw as unknown[]).map((u) => {
    if (!isInt(u) || Math.abs(u) > 1e6) bad('upgrade entries must be unit uids');
    return u as number;
  });
  const out: DeployAction = { round: a.round as number, place, upgrade };
  if (a.configure !== undefined) {
    if (!Array.isArray(a.configure) || a.configure.length > 200) bad('action.configure must be an array (max 200)');
    out.configure = (a.configure as unknown[]).map((c): UnitConfig => {
      if (!isObj(c)) bad('configure entry must be an object');
      const o = c as Record<string, unknown>;
      if (!isInt(o.uid) || Math.abs(o.uid as number) > 1e6) bad('configure.uid must be an integer');
      const cfg: UnitConfig = { uid: o.uid as number, ...readBehavior(o, 'configure') };
      if (o.kiteMount !== undefined) {
        if (!isInt(o.kiteMount) || (o.kiteMount as number) < -1 || (o.kiteMount as number) > 16) bad('configure.kiteMount must be a mount index or -1');
        cfg.kiteMount = o.kiteMount as number;
      }
      if (o.escort !== undefined) {
        if (!isInt(o.escort) || Math.abs(o.escort as number) > 1e6) bad('configure.escort must be a unit uid or -1');
        cfg.escort = o.escort as number;
      }
      return cfg;
    });
  }
  return out;
}
