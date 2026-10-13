// STUB — render agent implements. Keep the exported API.

import type { Battle } from '../../shared/sim/battle.ts';
import type { Design, Side } from '../../shared/types.ts';

export interface BoardUnit {
  side: Side;
  design: Design;
  /** world center (cells) */
  x: number;
  y: number;
  level: number;
  /** semi-transparent placement preview */
  ghost?: boolean;
  /** ghost drawn in red (illegal spot) */
  invalid?: boolean;
  /** selected / highlighted */
  selected?: boolean;
  /** drawn dimmed (e.g. locked units from earlier rounds when that matters) */
  dim?: boolean;
}

export interface BoardOverlay {
  /** tint the viewer's deploy zone */
  showZone?: boolean;
  /** cells to highlight, world cell coords */
  hover?: { col: number; row: number; size: number; valid: boolean } | null;
}

/**
 * Draws the battlefield on a canvas. The viewer's side is always at the bottom (side 1 sees the
 * field rotated 180°). Handles devicePixelRatio and fits the whole field into the canvas.
 */
export class FieldView {
  canvas: HTMLCanvasElement;
  viewerSide: Side;
  constructor(canvas: HTMLCanvasElement, viewerSide: Side) {
    this.canvas = canvas;
    this.viewerSide = viewerSide;
  }
  /** call when the canvas' CSS size changes */
  resize(): void {}
  worldToScreen(x: number, y: number): { x: number; y: number } { return { x, y }; }
  /** canvas CSS px (e.g. from offsetX/offsetY) -> world cells */
  screenToWorld(px: number, py: number): { x: number; y: number } { return { x: px, y: py }; }
  /** Deploy phase: static units and overlay. Call every frame (animates idle details). */
  drawBoard(units: BoardUnit[], overlay: BoardOverlay, time: number): void {}
  /** Battle phase: draw the sim's current state and spawn fx/sfx for battle.events.
   *  Call once per animation frame after stepping the sim; frameDt = real seconds since last frame. */
  drawBattle(battle: Battle, frameDt: number): void {}
  destroy(): void {}
}

/** Render a single design centered in a canvas (garage preview, cards). `time` animates rotors/legs. */
export function drawUnitPreview(canvas: HTMLCanvasElement, design: Design, opts?: { side?: Side; time?: number; angle?: number }): void {}
