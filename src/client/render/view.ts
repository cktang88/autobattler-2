// BattleView: the minimal surface that match.ts / menu.ts use of a battlefield renderer.
// FieldView (2D canvas, render/field.ts) and FieldView3D (three.js, render3d/FieldView3D.ts) both satisfy it.

import type { Battle } from '../../shared/sim/battle.ts';
import type { BattleEvent } from '../../shared/sim/types.ts';
import type { Side } from '../../shared/types.ts';
import type { BoardOverlay, BoardUnit } from './field.ts';
import type { MapTheme } from './ground.ts';

export interface BattleView {
  viewerSide: Side;
  /** no sound for battle events (menu background) */
  muted: boolean;
  /** accessibility multipliers / toggles (see applyViewSettings) */
  shakeScale: number;
  flashScale: number;
  alwaysShowHealth: boolean;
  /** camera state: k = CSS px per cell (1 cell = 5 m) */
  readonly cam: { readonly k: number };
  readonly controls: { enabled: boolean; doubleClickZoom: boolean; readonly wasDrag: boolean };
  /** true if the pointer gesture that just ended was a pan/pinch */
  readonly wasDrag: boolean;
  /** ground foreshortening (cos of tilt; 1 = top-down) and whether the tilt is on */
  readonly ay: number;
  readonly tilted: boolean;
  setTilt(on: boolean): void;
  setMap(map: MapTheme): void;
  resize(): void;
  fit(instant?: boolean): void;
  frameDeploy(instant?: boolean): void;
  zoomBy(f: number, screenX?: number, screenY?: number): void;
  /** world cells <-> canvas CSS px (ground plane) */
  worldToScreen(x: number, y: number): { x: number; y: number };
  screenToWorld(px: number, py: number): { x: number; y: number };
  /** queue a sim step's events (call after EVERY battle.step()) */
  pushEvents(events: BattleEvent[]): void;
  drawBoard(units: BoardUnit[], overlay: BoardOverlay, time: number): void;
  drawBattle(battle: Battle, frameDt: number): void;
  destroy(): void;
}
