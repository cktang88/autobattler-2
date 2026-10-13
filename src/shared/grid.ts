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

export const FIELD_W = 24;
export const FIELD_H = 32;
export const DEPLOY_W = FIELD_W;
export const DEPLOY_D = 9;

/** Top-left world cell of a placement of the given size. */
export function localToWorldCell(side: Side, x: number, y: number, size: Size): { col: number; row: number } {
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

export function inDeployZone(x: number, y: number, size: Size): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x + size <= DEPLOY_W && y + size <= DEPLOY_D;
}

/** Do two local-grid footprints overlap? */
export function overlaps(ax: number, ay: number, as: number, bx: number, by: number, bs: number): boolean {
  return ax < bx + bs && bx < ax + as && ay < by + bs && by < ay + as;
}
