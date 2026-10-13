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
//   size-1 designs -> a squad of 4 light units in a 2x2 formation
//   size-2 / size-3 designs -> a single unit (footprint 2x2 / 3x3 cells)
// Squads have a player-chosen SPACING of 0..MAX_SPACING empty cells between neighbouring units,
// so a squad occupies (2 + spacing) x (2 + spacing) cells: packed (10 m) up to spread out (30 m).
// Placement.x/.y is the block's top-left local cell. One Placement = one block; all its units share
// the Placement's uid and level.
// ---------------------------------------------------------------------------------------------

export const MAX_SPACING = 4;

/** number of units bought per block */
export const squadSize = (size: Size): number => (size === 1 ? 4 : 1);

/** can this design's block have spacing? (only multi-unit squads) */
export const hasSpacing = (size: Size): boolean => squadSize(size) > 1;

/** clamp/normalize a spacing value (non-squads always 0) */
export const normSpacing = (size: Size, spacing: number | undefined): number =>
  hasSpacing(size) ? Math.max(0, Math.min(MAX_SPACING, Math.round(spacing ?? 0))) : 0;

/** footprint edge length (cells) of a block */
export function blockCells(size: Size, spacing = 0): number {
  if (size === 1) return 2 + normSpacing(size, spacing);
  return size;
}

/** unit centers within a block, as offsets (cells) from the block's top-left corner */
export function squadOffsets(size: Size, spacing = 0): { x: number; y: number }[] {
  if (size === 1) {
    const far = 1.5 + normSpacing(size, spacing);
    return [{ x: 0.5, y: 0.5 }, { x: far, y: 0.5 }, { x: 0.5, y: far }, { x: far, y: far }];
  }
  const c = size / 2;
  return [{ x: c, y: c }];
}

type BlockPos = Pick<Placement, 'x' | 'y'> & { spacing?: number };

/** World-space centers of every unit in a placed block. */
export function placementUnitCenters(side: Side, p: BlockPos, size: Size): { x: number; y: number }[] {
  const cells = blockCells(size, p.spacing);
  const { col, row } = localToWorldCell(side, p.x, p.y, cells);
  return squadOffsets(size, p.spacing).map((o) => ({ x: col + o.x, y: row + o.y }));
}

/** World-space center of a placed block. */
export function blockCenter(side: Side, p: BlockPos, size: Size): { x: number; y: number } {
  const cells = blockCells(size, p.spacing);
  const { col, row } = localToWorldCell(side, p.x, p.y, cells);
  return { x: col + cells / 2, y: row + cells / 2 };
}

/** Is a block of this design size (and spacing) inside the deploy zone at local (x, y)? */
export function blockInZone(x: number, y: number, size: Size, spacing = 0): boolean {
  return inDeployZone(x, y, blockCells(size, spacing));
}
