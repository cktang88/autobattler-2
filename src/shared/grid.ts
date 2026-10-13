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
// Blocks & squads (Mechabellum-style). Every purchase is one BLOCK placed on a coarse grid:
//   size-1 designs -> a squad of 4 light units filling a 2x2-cell (10 m) block
//   size-2 designs -> 1 unit in a 2x2-cell block
//   size-3 designs -> 1 unit in a 4x4-cell (20 m) block
// Placement.x/.y is the block's top-left local cell and must be a multiple of BLOCK.
// One Placement = one block; all its units share the Placement's uid and level.
// ---------------------------------------------------------------------------------------------

/** block grid step, in cells */
export const BLOCK = 2;

/** footprint edge length (cells) of a block holding a design of this chassis size */
export const blockCells = (size: Size): number => (size === 3 ? 4 : 2);

/** number of units bought per block */
export const squadSize = (size: Size): number => (size === 1 ? 4 : 1);

/** unit centers within a block, as offsets (cells) from the block's top-left corner */
export function squadOffsets(size: Size): { x: number; y: number }[] {
  if (size === 1) return [{ x: 0.5, y: 0.5 }, { x: 1.5, y: 0.5 }, { x: 0.5, y: 1.5 }, { x: 1.5, y: 1.5 }];
  const c = blockCells(size) / 2;
  return [{ x: c, y: c }];
}

/** World-space centers of every unit in a placed block. */
export function placementUnitCenters(side: Side, p: Pick<Placement, 'x' | 'y'>, size: Size): { x: number; y: number }[] {
  const cells = blockCells(size);
  const { col, row } = localToWorldCell(side, p.x, p.y, cells);
  return squadOffsets(size).map((o) => ({ x: col + o.x, y: row + o.y }));
}

/** World-space center of a placed block. */
export function blockCenter(side: Side, p: Pick<Placement, 'x' | 'y'>, size: Size): { x: number; y: number } {
  const cells = blockCells(size);
  const { col, row } = localToWorldCell(side, p.x, p.y, cells);
  return { x: col + cells / 2, y: row + cells / 2 };
}

/** Is a block of this design size legal at local (x, y)? (on the block grid and inside the zone) */
export function blockInZone(x: number, y: number, size: Size): boolean {
  return x % BLOCK === 0 && y % BLOCK === 0 && inDeployZone(x, y, blockCells(size));
}
