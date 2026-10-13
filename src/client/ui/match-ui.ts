// Small shared UI helpers for my screens: modals, confirm dialogs, deck cards.

import { h } from '../app.ts';
import { sfx } from '../audio.ts';
import { drawUnitPreview } from '../render/field.ts';
import { computeStats } from '../../shared/stats.ts';
import type { Design, Side } from '../../shared/types.ts';

export interface ModalHandle { close(): void; el: HTMLElement }

export function openModal(title: string, body: Node, actions: HTMLElement[] = []): ModalHandle {
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const closeBtn = h('button', { onclick: () => { sfx('click'); close(); } }, actions.length ? 'Cancel' : 'Close');
  const panel = h('div.panel.modal', { role: 'dialog' },
    h('h2', null, title),
    body,
    h('div.modal-actions', null, ...actions, closeBtn),
  );
  const back = h('div.modal-back', { onclick: (e: Event) => { if (e.target === back) close(); } }, panel);
  document.addEventListener('keydown', onKey, true);
  document.body.append(back);
  return { close, el: panel };
}

export function confirmModal(title: string, text: string, okLabel: string, danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const ok = h(danger ? 'button.danger' : 'button.primary', {
      onclick: () => { done = true; m.close(); resolve(true); },
    }, okLabel);
    const m = openModal(title, h('p', null, text), [ok]);
    // resolve false when closed any other way
    const obs = new MutationObserver(() => {
      if (!m.el.isConnected) { obs.disconnect(); if (!done) resolve(false); }
    });
    obs.observe(document.body, { childList: true });
  });
}

/** Size the canvas backing store to its CSS box * devicePixelRatio, then draw a design preview. */
export function paintPreview(canvas: HTMLCanvasElement, design: Design, side: Side = 0, time = 0): void {
  const r = canvas.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(r.width * dpr), hh = Math.round(r.height * dpr);
  if (canvas.width !== w || canvas.height !== hh) { canvas.width = w; canvas.height = hh; }
  try { drawUnitPreview(canvas, design, { side, time, angle: -Math.PI / 2 }); } catch (e) { console.warn('preview', e); }
}

/** Paint previews once the canvases are laid out (call after inserting into DOM). */
export function paintWhenLaidOut(items: { canvas: HTMLCanvasElement; design: Design; side?: Side }[]): void {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    for (const it of items) paintPreview(it.canvas, it.design, it.side ?? 0);
  }));
}

export function sizeLabel(size: number): string {
  return size === 1 ? 'Light' : size === 2 ? 'Medium' : 'Heavy';
}

export function safeStats(d: Design) {
  try { return computeStats(d); } catch { return null; }
}
