// Modal dialogs (kept free of renderer imports: the menu and account chip open them before any battle code loads).

import { h } from '../app.ts';
import { sfx } from '../audio.ts';

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
