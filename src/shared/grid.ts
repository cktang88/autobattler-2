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

/** Real-world scale: one grid cell is 5 m x 5 m (Mechabellum-style). The field is 240 m x 230 m.
 *  A size-1 unit is a 5 m light vehicle, size 2 a 10 m tank, size 3 a 15 m walker. All ranges/speeds in
 *  data are in cells; multiply by METERS_PER_CELL for display. */
export const METERS_PER_CELL = 5;
export const FIELD_W = 48;
export const FIELD_H = 46;
export const DEPLOY_W = FIELD_W;
export const DEPLOY_D = 12;

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
//   size-1 designs -> a squad of 16 light units in an 8-wide x 2-deep rectangle (SQUAD_LAYOUT)
//   size-2+ designs -> a single unit (footprint size x size cells)
// Squads have a player-chosen SPACING of 0..MAX_SPACING empty cells between neighbouring units, so a
// squad's footprint is (8 + 7s) x (2 + s) cells: packed 40 m x 10 m up to spread 180 m x 30 m.
// Footprints are RECTANGLES: w = across the field (local x), h = depth (local y). Placement.x/.y is the
// block's top-left local cell. One Placement = one block; all its units share its uid and level.
// ---------------------------------------------------------------------------------------------

export const MAX_SPACING = 4;

/** squad formation (cols across, rows deep) per chassis size */
export const SQUAD_LAYOUT: Record<Size, [number, number]> = { 1: [8, 2], 2: [1, 1], 3: [1, 1], 4: [1, 1], 5: [1, 1] };

/** number of units bought per block */
export const squadSize = (size: Size): number => SQUAD_LAYOUT[size][0] * SQUAD_LAYOUT[size][1];

/** can this design's block have spacing? (only multi-unit squads) */
export const hasSpacing = (size: Size): boolean => squadSize(size) > 1;

/** clamp/normalize a spacing value (non-squads always 0) */
export const normSpacing = (size: Size, spacing: number | undefined): number =>
  hasSpacing(size) ? Math.max(0, Math.min(MAX_SPACING, Math.round(spacing ?? 0))) : 0;

/** footprint of a block in cells: w across the field (local x), h deep (local y) */
export function blockDims(size: Size, spacing = 0): { w: number; h: number } {
  const [cols, rows] = SQUAD_LAYOUT[size];
  if (cols * rows === 1) return { w: size, h: size };
  const sp = normSpacing(size, spacing);
  return { w: cols + (cols - 1) * sp, h: rows + (rows - 1) * sp };
}

/** unit centers within a block, as offsets (cells) from the block's top-left corner (local orientation) */
export function squadOffsets(size: Size, spacing = 0): { x: number; y: number }[] {
  const [cols, rows] = SQUAD_LAYOUT[size];
  if (cols * rows === 1) return [{ x: size / 2, y: size / 2 }];
  const step = 1 + normSpacing(size, spacing);
  const out: { x: number; y: number }[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push({ x: 0.5 + c * step, y: 0.5 + r * step });
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

type BlockPos = Pick<Placement, 'x' | 'y'> & { spacing?: number };

/** World-space centers of every unit in a placed block. Side 1's offsets are mirrored (180° rotation). */
export function placementUnitCenters(side: Side, p: BlockPos, size: Size): { x: number; y: number }[] {
  const { w, h } = blockDims(size, p.spacing);
  const { col, row } = localRectToWorld(side, p.x, p.y, w, h);
  return squadOffsets(size, p.spacing).map((o) => (side === 0 ? { x: col + o.x, y: row + o.y } : { x: col + w - o.x, y: row + h - o.y }));
}

/** World-space center of a placed block. */
export function blockCenter(side: Side, p: BlockPos, size: Size): { x: number; y: number } {
  const { w, h } = blockDims(size, p.spacing);
  const { col, row } = localRectToWorld(side, p.x, p.y, w, h);
  return { x: col + w / 2, y: row + h / 2 };
}

/** World-space rectangle {col,row,w,h} covered by a placed block (for highlights). */
export function blockWorldRect(side: Side, p: BlockPos, size: Size): { col: number; row: number; w: number; h: number } {
  const { w, h } = blockDims(size, p.spacing);
  return { ...localRectToWorld(side, p.x, p.y, w, h), w, h };
}

/** Is a block of this design size (and spacing) inside the deploy zone at local (x, y)? */
export function blockInZone(x: number, y: number, size: Size, spacing = 0): boolean {
  const { w, h } = blockDims(size, spacing);
  return rectInZone(x, y, w, h);
}

/** Do two placed blocks overlap? */
export function blocksOverlap(a: BlockPos, aSize: Size, b: BlockPos, bSize: Size): boolean {
  const da = blockDims(aSize, a.spacing), db = blockDims(bSize, b.spacing);
  return rectsOverlap(a.x, a.y, da.w, da.h, b.x, b.y, db.w, db.h);
}
