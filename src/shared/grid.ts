// Battlefield geometry. World units are cells (1 cell = 1 world unit).
//
//   y = 0 ┌──────────────── FIELD_W ────────────────┐
//         │  side 1 deploy zone (DEPLOY_D rows)      │
//         │                                          │
//         │  no-man's land                           │
//         │                                          │
//         │  side 0 deploy zone (DEPLOY_D rows)      │
// FIELD_H └──────────────────────────────────────────┘
//
// Each player places units on a LOCAL grid DEPLOY_W x DEPLOY_D where local y = 0 is the FRONT row
// (closest to the enemy) and x runs left-to-right from that player's own point of view.
// Side 1's board is rotated 180° so both players get the same view of "their" field.

import type { Placement, Side, Size } from './types.ts';

/** Real-world scale: one grid cell is 5 m x 5 m (Mechabellum-style). The field is 480 m x 460 m.
 *  A size-1 unit is a 5 m light vehicle, size 2 a 10 m tank, size 3 a 15 m walker. All ranges/speeds in
 *  data are in cells; multiply by METERS_PER_CELL for display. */
export const METERS_PER_CELL = 5;
export let FIELD_W = 96;
export let FIELD_H = 92;
export let DEPLOY_W = FIELD_W;
export let DEPLOY_D = 24;

/** A battlefield's size in cells: w across, h long (side to side), deploy = rows of each side's deploy zone. */
export interface FieldSize { w: number; h: number; deploy: number }
/** the round-based modes' field */
export const STANDARD_FIELD: Readonly<FieldSize> = { w: 96, h: 92, deploy: 24 };
/** the largest field any mode uses (sizes fixed buffers, e.g. the sim's spatial hash) */
export const MAX_FIELD_W = 96;
export const MAX_FIELD_H = 116;

/** Switch the battlefield size (the FIELD_* / DEPLOY_* bindings above are live). Tug of war plays on its own narrow,
 *  long field and puts the standard one back when it ends; everything else always runs on STANDARD_FIELD. */
export function setField(f: Readonly<FieldSize>): void {
  if (f.w > MAX_FIELD_W || f.h > MAX_FIELD_H) throw new Error(`field ${f.w}x${f.h} is larger than ${MAX_FIELD_W}x${MAX_FIELD_H}`);
  FIELD_W = f.w;
  FIELD_H = f.h;
  DEPLOY_W = f.w;
  DEPLOY_D = f.deploy;
}
/** cache key part for anything drawn or built at the current field size */
export const fieldKey = (): string => `${FIELD_W}x${FIELD_H}x${DEPLOY_D}`;

/** Top-left world cell of a placement of the given size. */
export function localToWorldCell(side: Side, x: number, y: number, size: number): { col: number; row: number } {
  if (side === 0) return { col: x, row: FIELD_H - DEPLOY_D + y };
  return { col: FIELD_W - x - size, row: DEPLOY_D - y - size };
}

/** World-space center of a placed unit (cells, float). */
export function placementCenter(side: Side, p: Pick<Placement, 'x' | 'y'>, size: Size): { x: number; y: number } {
  const { col, row } = localToWorldCell(side, p.x, p.y, size);
  return { x: col + size / 2, y: row + size / 2 };
}

/** Direction (in world y) a side advances: side 0 moves up (-1), side 1 moves down (+1). */
export const forwardY = (side: Side) => (side === 0 ? -1 : 1);

/** `size` = footprint edge in cells */
export function inDeployZone(x: number, y: number, size: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x + size <= DEPLOY_W && y + size <= DEPLOY_D;
}

/** Do two local-grid footprints overlap? */
export function overlaps(ax: number, ay: number, as: number, bx: number, by: number, bs: number): boolean {
  return ax < bx + bs && bx < ax + as && ay < by + bs && by < ay + as;
}

/** Format a distance given in cells as metres, e.g. 4.5 -> "23 m". */
export const fmtMeters = (cells: number) => `${Math.round(cells * METERS_PER_CELL)} m`;
/** Format a speed given in cells/s as metres per second, e.g. 3.2 -> "16 m/s". */
export const fmtSpeed = (cellsPerSec: number) => `${Math.round(cellsPerSec * METERS_PER_CELL)} m/s`;

// ---------------------------------------------------------------------------------------------
// Blocks & squads (Mechabellum-style). Every purchase is one BLOCK placed on the cell grid:
//   size-1 designs -> a squad of light units in a rectangle; how many depends on the design's per-unit price
//                     (stats.ts squadFor: cheap units come 16 to a block (8 x 2), pricier ones 8 (4 x 2) or 4 (2 x 2))
//   size-2 designs  -> likewise 4 (2 x 2), 2 (2 x 1) or 1 medium unit(s); each unit keeps its chassis footprint
//   size-3+ designs -> a single unit (footprint size x size cells, or the chassis footprint)
// The grid never decides the squad itself: every function takes the design's BlockShape (UnitStats satisfies it),
// so the squad count has one source of truth (computeStats().squad).
// Squads have a player-chosen SPACING of 0..MAX_SPACING empty cells between neighbouring units, so a squad of
// cols x rows units of fw x fh cells has a footprint of (cols fw + (cols - 1) s) x (rows fh + (rows - 1) s) cells (an 8 x 2 squad: packed
// 40 m x 10 m up to spread 110 m x 20 m). Footprints are RECTANGLES: w = across the field (local x), h = depth
// (local y). Placement.x/.y is the block's top-left local cell. One Placement = one block; all its units share its
// uid and level.
// ---------------------------------------------------------------------------------------------

export const MAX_SPACING = 2;

/** What the grid needs to know about a design's block: hull size class, units per block and (non-square chassis)
 *  the unit footprint (fw across, fh deep; omitted = size x size). UnitStats satisfies it. */
export interface BlockShape { size: Size; squad: number; fw?: number; fh?: number }

/** formation (cols across, rows deep) per squad count; other counts fall back to one row */
const SQUAD_LAYOUTS: Record<number, [number, number]> = { 1: [1, 1], 2: [2, 1], 4: [2, 2], 8: [4, 2], 16: [8, 2] };

/** Squad formation (cols across, rows deep) for `squad` units; `rot` turns the block 90° (8x2 -> 2x8). */
export function squadLayout(squad: number, rot = false): [number, number] {
  const [c, r] = SQUAD_LAYOUTS[squad] ?? [Math.max(1, squad), 1];
  return rot && c * r > 1 ? [r, c] : [c, r];
}

/** can this block have spacing / be rotated? (only multi-unit squads) */
export const hasSpacing = (b: Pick<BlockShape, 'squad'>): boolean => b.squad > 1;

/** clamp/normalize a spacing value (non-squads always 0) */
export const normSpacing = (b: Pick<BlockShape, 'squad'>, spacing: number | undefined): number =>
  hasSpacing(b) ? Math.max(0, Math.min(MAX_SPACING, Math.round(spacing ?? 0))) : 0;

/** footprint of a block in cells: w across the field (local x), h deep (local y). Units face the enemy, so the unit's
 *  own fh runs along local y. */
export function blockDims(b: BlockShape, spacing = 0, rot = false): { w: number; h: number } {
  const uw = b.fw ?? b.size, uh = b.fh ?? b.size;
  const [cols, rows] = squadLayout(b.squad, rot);
  if (cols * rows === 1) return { w: uw, h: uh };
  const sp = normSpacing(b, spacing);
  return { w: cols * uw + (cols - 1) * sp, h: rows * uh + (rows - 1) * sp };
}

/** unit centers within a block, as offsets (cells) from the block's top-left corner (local orientation) */
export function squadOffsets(b: BlockShape, spacing = 0, rot = false): { x: number; y: number }[] {
  const uw = b.fw ?? b.size, uh = b.fh ?? b.size;
  const [cols, rows] = squadLayout(b.squad, rot);
  if (cols * rows === 1) return [{ x: uw / 2, y: uh / 2 }];
  const sp = normSpacing(b, spacing);
  const out: { x: number; y: number }[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push({ x: uw / 2 + c * (uw + sp), y: uh / 2 + r * (uh + sp) });
  return out;
}

/** Top-left WORLD cell of a local w x h rectangle (side 1 is rotated 180°). */
export function localRectToWorld(side: Side, x: number, y: number, w: number, h: number): { col: number; row: number } {
  if (side === 0) return { col: x, row: FIELD_H - DEPLOY_D + y };
  return { col: FIELD_W - x - w, row: DEPLOY_D - y - h };
}

/** Do two local-grid rectangles overlap? */
export function rectsOverlap(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number): boolean {
  return ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah;
}

/** Is a local w x h rectangle at (x, y) fully inside the deploy zone (integer cells)? */
export function rectInZone(x: number, y: number, w: number, h: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x + w <= DEPLOY_W && y + h <= DEPLOY_D;
}

type BlockPos = Pick<Placement, 'x' | 'y'> & { spacing?: number; rot?: boolean };

/** World-space centers of every unit in a placed block. Side 1's offsets are mirrored (180° rotation). */
export function placementUnitCenters(side: Side, p: BlockPos, b: BlockShape): { x: number; y: number }[] {
  const { w, h } = blockDims(b, p.spacing, p.rot);
  const { col, row } = localRectToWorld(side, p.x, p.y, w, h);
  return squadOffsets(b, p.spacing, p.rot).map((o) => (side === 0 ? { x: col + o.x, y: row + o.y } : { x: col + w - o.x, y: row + h - o.y }));
}

/** World-space center of a placed block. */
export function blockCenter(side: Side, p: BlockPos, b: BlockShape): { x: number; y: number } {
  const { w, h } = blockDims(b, p.spacing, p.rot);
  const { col, row } = localRectToWorld(side, p.x, p.y, w, h);
  return { x: col + w / 2, y: row + h / 2 };
}

/** World-space rectangle {col,row,w,h} covered by a placed block (for highlights). */
export function blockWorldRect(side: Side, p: BlockPos, b: BlockShape): { col: number; row: number; w: number; h: number } {
  const { w, h } = blockDims(b, p.spacing, p.rot);
  return { ...localRectToWorld(side, p.x, p.y, w, h), w, h };
}

/** Is a block of this shape (and spacing) inside the deploy zone at local (x, y)? */
export function blockInZone(x: number, y: number, b: BlockShape, spacing = 0, rot = false): boolean {
  const { w, h } = blockDims(b, spacing, rot);
  return rectInZone(x, y, w, h);
}

/** Do two placed blocks overlap? */
export function blocksOverlap(a: BlockPos, aShape: BlockShape, b: BlockPos, bShape: BlockShape): boolean {
  const da = blockDims(aShape, a.spacing, a.rot), db = blockDims(bShape, b.spacing, b.rot);
  return rectsOverlap(a.x, a.y, da.w, da.h, b.x, b.y, db.w, db.h);
}
