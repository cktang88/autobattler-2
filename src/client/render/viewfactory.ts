// Chooses the battlefield renderer from Settings.renderer. three.js lives in a separate lazily-loaded chunk;
// until it has loaded (or if WebGL is unavailable) the 2D FieldView is used.

import { loadSettings } from '../storage.ts';
import { FieldView } from './field.ts';
import type { BattleView } from './view.ts';
import type { Side } from '../../shared/types.ts';

type Ctor3D = new (canvas: HTMLCanvasElement, side: Side, opts?: { interactive?: boolean }) => BattleView;
let ctor3d: Ctor3D | null = null;
let loading: Promise<void> | null = null;

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

/** Start loading the 3D renderer (idempotent). Resolves when ready or failed. */
export function preload3d(): Promise<void> {
  loading ??= import('../render3d/FieldView3D.ts').then((m) => { ctor3d = m.FieldView3D as unknown as Ctor3D; }).catch((e) => { console.warn('3D renderer unavailable', e); });
  return loading;
}

export function makeView(canvas: HTMLCanvasElement, side: Side, opts?: { interactive?: boolean }): BattleView {
  if (loadSettings().renderer === '3d') {
    if (!ctor3d) void preload3d();
    else if (webglAvailable()) {
      try { return new ctor3d(canvas, side, opts); } catch (e) { console.warn('3D renderer failed, using 2D', e); }
    }
  }
  return new FieldView(canvas, side, opts) as unknown as BattleView;
}
