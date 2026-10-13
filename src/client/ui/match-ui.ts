// Small shared UI helpers for my screens: modals, confirm dialogs, deck cards.

import { h } from '../app.ts';
import { sfx } from '../audio.ts';
import { drawUnitPreview } from '../render/field.ts';
import { computeStats } from '../../shared/stats.ts';
import { TARGET_PRIORITIES, type Design, type Side, type TargetPriority, type UnitBehavior } from '../../shared/types.ts';

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

// ---- battle AI settings (targeting / formation / kite): shared by the match screen and the garage ----
export const TARGET_INFO: Record<TargetPriority, { icon: string; label: string; tip: string }> = {
  closest: { icon: '◉', label: 'Closest', tip: 'Closest: shoot the nearest enemy (default)' },
  farthest: { icon: '◌', label: 'Farthest', tip: 'Farthest: shoot the most distant enemy in range' },
  threat: { icon: '↩', label: 'Threat', tip: 'Threat (retaliate): shoot whoever last damaged this unit or its squad, else the closest' },
  lowestHp: { icon: '▾', label: 'Low HP', tip: 'Lowest HP: finish off the weakest enemy in range' },
  highestHp: { icon: '▴', label: 'High HP', tip: 'Highest HP: focus the toughest enemy in range' },
  highestDps: { icon: '✶', label: 'High DPS', tip: 'Highest DPS: prioritise the enemy with the most damage output' },
  lowestDps: { icon: '✧', label: 'Low DPS', tip: 'Lowest DPS: prioritise the enemy with the least damage output' },
};
export type Orders = { target: TargetPriority; hold: boolean; kite: boolean };
export const DEFAULT_ORDERS: Orders = { target: 'closest', hold: false, kite: false };
export const ordersOf = (b: UnitBehavior | undefined): Orders => ({
  target: b?.target && TARGET_PRIORITIES.includes(b.target) ? b.target : 'closest', hold: !!b?.hold, kite: !!b?.kite,
});
export const isCustomOrders = (o: Orders) => o.target !== DEFAULT_ORDERS.target || o.hold || o.kite;
/** compact form: only non-default fields (what Placement / Design.behavior store) */
export const orderFields = (o: Orders): UnitBehavior => ({ ...(o.target !== 'closest' ? { target: o.target } : {}), ...(o.hold ? { hold: true } : {}), ...(o.kite ? { kite: true } : {}) });

/** Targeting priority + (squads) formation + kite. `title` heads the control; `custom` marks non-default values. */
export function ordersControl(o: Orders, squad: boolean, on: (patch: Partial<Orders>) => void, opts: { title?: string; custom?: boolean } = {}): HTMLElement {
  const toggle = (label: string, tip: string, v: boolean, key: 'hold' | 'kite', yes: string, no: string) => h('div.hold-row', null,
    h('span', { title: tip }, label),
    h('div.sp-segs.two', { role: 'group', 'aria-label': label },
      h('button.seg', { type: 'button', class: v ? 'on' : null, title: tip, 'data-orders': `${key}-on`, onclick: () => on({ [key]: true }) }, yes),
      h('button.seg', { type: 'button', class: !v ? 'on' : null, 'data-orders': `${key}-off`, onclick: () => on({ [key]: false }) }, no),
    ));
  return h('div.orders', null,
    h('div.sp-head', null, h('span', null, opts.title ?? 'Targeting'), opts.custom !== false && isCustomOrders(o) ? h('span.custom-tag', { title: 'Differs from the default orders' }, 'custom') : null),
    h('div.tgt-grid', { role: 'group', 'aria-label': 'Targeting priority' }, ...TARGET_PRIORITIES.map((t) => h('button.tgt', {
      type: 'button', class: t === o.target ? 'on' : null, 'aria-pressed': String(t === o.target), title: TARGET_INFO[t].tip, 'data-target': t,
      onclick: () => on({ target: t }),
    }, h('i', null, TARGET_INFO[t].icon), TARGET_INFO[t].label))),
    squad ? toggle('Formation', 'Keep spread: units hold their deployed spacing while moving. Close in: units move freely toward the enemy.', o.hold, 'hold', 'Keep spread', 'Close in') : null,
    toggle('Range', 'Kite: stay at maximum weapon range and back away from enemies that close in', o.kite, 'kite', 'Kite', 'Stand'),
  );
}
