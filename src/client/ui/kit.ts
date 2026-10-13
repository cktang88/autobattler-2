// Themed UI kit: game-styled replacements for native form controls (dropdown, segmented selector, switch, slider,
// text field). All keyboard accessible; styles live in public/kit.css (.k-*).

import { h } from '../app.ts';

export interface KOption<T extends string = string> {
  value: T;
  label: string;
  /** secondary line shown in the open list */
  hint?: string;
  /** small leading glyph / node */
  icon?: Node | string;
  disabled?: boolean;
}

const chevron = () => {
  const s = h('span.k-chev', { 'aria-hidden': 'true' });
  s.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
  return s;
};

let openClose: (() => void) | null = null;
let uid = 0;

/** Dropdown. The list opens in a body-level popover so panels with overflow never clip it. */
export function select<T extends string>(o: {
  value: T; options: KOption<T>[]; onChange: (v: T) => void;
  label?: string; prefix?: string; title?: string; className?: string; fk?: string; disabled?: boolean;
}): HTMLButtonElement {
  const cur = o.options.find((x) => x.value === o.value) ?? o.options[0];
  const id = `k-list-${++uid}`;
  const btn = h('button.k-select', {
    type: 'button', role: 'combobox', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-controls': id,
    'aria-label': o.label ?? null, title: o.title ?? null, class: o.className ?? null, 'data-fk': o.fk ?? null, disabled: o.disabled || null,
  },
  o.prefix ? h('span.k-select-pre', null, o.prefix) : null,
  cur?.icon ? h('span.k-select-ico', null, cur.icon) : null,
  h('span.k-select-v', null, cur?.label ?? ''),
  chevron());

  let pop: HTMLElement | null = null;
  let active = 0;
  const items: HTMLElement[] = [];

  // the popover lives outside the button: drop it if the button leaves the DOM (screen re-render)
  const mo = new MutationObserver(() => { if (!btn.isConnected) close(false); });
  const close = (refocus = true) => {
    if (!pop) return;
    mo.disconnect();
    pop.remove();
    pop = null;
    btn.setAttribute('aria-expanded', 'false');
    btn.classList.remove('open');
    document.removeEventListener('pointerdown', onOutside, true);
    window.removeEventListener('resize', onWin);
    window.removeEventListener('scroll', onScroll, true);
    if (openClose === closeThis) openClose = null;
    if (refocus && btn.isConnected) btn.focus();
  };
  const closeThis = () => close(false);
  const onOutside = (e: Event) => { if (pop && !pop.contains(e.target as Node) && !btn.contains(e.target as Node)) close(false); };
  const onWin = () => close(false);
  const onScroll = (e: Event) => { if (pop && !pop.contains(e.target as Node)) close(false); };

  const setActive = (i: number) => {
    const n = o.options.length;
    for (let k = 0; k < n; k++) {
      const j = ((i + k) % n + n) % n;
      if (!o.options[j].disabled) { i = j; break; }
    }
    active = i;
    items.forEach((it, k) => it.classList.toggle('act', k === active));
    btn.setAttribute('aria-activedescendant', `${id}-${active}`);
    items[active]?.scrollIntoView({ block: 'nearest' });
  };
  const choose = (i: number) => {
    const opt = o.options[i];
    if (!opt || opt.disabled) return;
    close();
    if (opt.value !== o.value) o.onChange(opt.value);
  };

  const open = () => {
    if (pop || o.disabled) return;
    openClose?.();
    openClose = closeThis;
    items.length = 0;
    pop = h('div.k-pop', { role: 'listbox', id, 'aria-label': o.label ?? null },
      ...o.options.map((opt, i) => {
        const it = h('div.k-opt', {
          role: 'option', id: `${id}-${i}`, 'aria-selected': String(opt.value === o.value), 'aria-disabled': opt.disabled ? 'true' : null,
          class: [opt.value === o.value ? 'sel' : '', opt.disabled ? 'dis' : ''].join(' '),
          onpointerenter: () => setActive(i),
          onclick: () => choose(i),
        },
        opt.icon ? h('span.k-opt-ico', null, opt.icon) : null,
        h('span.k-opt-t', null, h('span.k-opt-l', null, opt.label), opt.hint ? h('span.k-opt-h', null, opt.hint) : null));
        items.push(it);
        return it;
      }));
    document.body.append(pop);
    const r = btn.getBoundingClientRect();
    pop.style.minWidth = `${Math.max(r.width, 180)}px`;
    const ph = pop.offsetHeight;
    const below = innerHeight - r.bottom - 8;
    const up = ph > below && r.top > below;
    pop.style.left = `${Math.min(r.left, innerWidth - pop.offsetWidth - 8)}px`;
    pop.style.top = up ? `${Math.max(8, r.top - ph - 4)}px` : `${r.bottom + 4}px`;
    if (!up) pop.style.maxHeight = `${Math.max(160, below)}px`;
    btn.setAttribute('aria-expanded', 'true');
    btn.classList.add('open');
    setActive(Math.max(0, o.options.findIndex((x) => x.value === o.value)));
    document.addEventListener('pointerdown', onOutside, true);
    window.addEventListener('resize', onWin);
    window.addEventListener('scroll', onScroll, true);
    mo.observe(document.body, { childList: true, subtree: true });
  };

  btn.addEventListener('click', () => (pop ? close() : open()));
  btn.addEventListener('keydown', (e) => {
    const k = e.key;
    if (!pop) {
      if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Enter' || k === ' ') { e.preventDefault(); open(); }
      return;
    }
    if (k === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
    else if (k === 'ArrowUp') { e.preventDefault(); setActive(active - 1 + o.options.length); }
    else if (k === 'Home') { e.preventDefault(); setActive(0); }
    else if (k === 'End') { e.preventDefault(); setActive(o.options.length - 1); }
    else if (k === 'Enter' || k === ' ') { e.preventDefault(); choose(active); }
    else if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (k === 'Tab') close(false);
    else if (k.length === 1 && /\S/.test(k)) {
      const n = o.options.length;
      for (let s = 1; s <= n; s++) {
        const j = (active + s) % n;
        if (o.options[j].label.toLowerCase().startsWith(k.toLowerCase())) { setActive(j); break; }
      }
    }
  });
  return btn;
}

/** Single-choice segmented selector (radio group). */
export function segmented<T extends string | number>(o: {
  value: T; options: { value: T; label: string | Node; title?: string; disabled?: boolean }[]; onChange: (v: T) => void;
  label?: string; className?: string; fk?: string; disabled?: boolean;
}): HTMLElement {
  const btns: HTMLButtonElement[] = [];
  const pick = (i: number) => {
    const opt = o.options[i];
    if (!opt || opt.disabled || o.disabled) return;
    if (opt.value !== o.value) o.onChange(opt.value);
  };
  const g = h('div.k-seg', { role: 'radiogroup', 'aria-label': o.label ?? null, class: o.className ?? null },
    ...o.options.map((opt, i) => {
      const on = opt.value === o.value;
      const b = h('button.k-seg-b', {
        type: 'button', role: 'radio', 'aria-checked': String(on), class: on ? 'on' : null, title: opt.title ?? null,
        tabindex: on ? '0' : '-1', disabled: opt.disabled || o.disabled || null, 'data-fk': o.fk ? `${o.fk}-${String(opt.value)}` : null,
        onclick: () => pick(i),
        onkeydown: (e: KeyboardEvent) => {
          const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
          if (!d) return;
          e.preventDefault();
          const n = o.options.length;
          let j = i;
          for (let s = 0; s < n; s++) { j = (j + d + n) % n; if (!o.options[j].disabled) break; }
          pick(j);
          // the caller usually re-renders; focus whatever now carries this value
          requestAnimationFrame(() => { (document.querySelector(`[data-fk="${o.fk}-${String(o.options[j].value)}"]`) as HTMLElement | null)?.focus(); btns[j]?.isConnected && btns[j].focus(); });
        },
      }, opt.label);
      btns.push(b);
      return b;
    }));
  if (!o.options.some((x) => x.value === o.value) && btns[0]) btns[0].tabIndex = 0;
  return g;
}

/** On/off switch with an indicator lamp. */
export function toggle(o: { label: string | Node; on: boolean; onChange: (v: boolean) => void; title?: string; className?: string; fk?: string; disabled?: boolean }): HTMLButtonElement {
  return h('button.k-toggle', {
    type: 'button', role: 'switch', 'aria-checked': String(o.on), class: [o.on ? 'on' : '', o.className ?? ''].join(' '),
    title: o.title ?? null, 'data-fk': o.fk ?? null, disabled: o.disabled || null,
    onclick: () => o.onChange(!o.on),
  }, h('span.k-lamp', { 'aria-hidden': 'true' }), h('span.k-toggle-l', null, o.label));
}

/** Horizontal slider (role=slider). `onInput` fires while dragging, `onCommit` once released. */
export function slider(o: {
  value: number; min?: number; max?: number; step?: number; label: string;
  onInput: (v: number) => void; onCommit?: (v: number) => void; format?: (v: number) => string;
}): HTMLElement {
  const min = o.min ?? 0, max = o.max ?? 100, step = o.step ?? 1;
  let v = o.value;
  const fill = h('span.k-slider-fill');
  const thumb = h('span.k-slider-thumb');
  const out = h('output.k-slider-out');
  const track = h('span.k-slider-track', null, fill, thumb);
  const el = h('div.k-slider', { role: 'slider', tabindex: '0', 'aria-label': o.label, 'aria-valuemin': String(min), 'aria-valuemax': String(max) }, track, out);
  const paint = () => {
    const f = (v - min) / (max - min || 1);
    fill.style.width = `${f * 100}%`;
    thumb.style.left = `${f * 100}%`;
    el.setAttribute('aria-valuenow', String(v));
    out.textContent = o.format ? o.format(v) : String(v);
  };
  const set = (nv: number) => {
    nv = Math.min(max, Math.max(min, Math.round(nv / step) * step));
    if (nv === v) return;
    v = nv;
    paint();
    o.onInput(v);
  };
  const fromX = (x: number) => {
    const r = track.getBoundingClientRect();
    set(min + ((x - r.left) / (r.width || 1)) * (max - min));
  };
  let dragging = false;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    dragging = true;
    el.setPointerCapture(e.pointerId);
    el.classList.add('drag');
    fromX(e.clientX);
  });
  el.addEventListener('pointermove', (e) => { if (dragging) fromX(e.clientX); });
  const end = () => { if (!dragging) return; dragging = false; el.classList.remove('drag'); o.onCommit?.(v); };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('keydown', (e) => {
    const big = (max - min) / 10;
    const d = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step, PageUp: big, PageDown: -big }[e.key];
    if (d !== undefined) { e.preventDefault(); set(v + d); o.onCommit?.(v); }
    else if (e.key === 'Home') { e.preventDefault(); set(min); o.onCommit?.(v); }
    else if (e.key === 'End') { e.preventDefault(); set(max); o.onCommit?.(v); }
  });
  paint();
  return el;
}

/** Text field: themed frame around a native input (text entry itself stays native for IME / mobile keyboards). */
export function textField(o: {
  value?: string; placeholder?: string; maxlength?: number; label: string; icon?: Node; type?: 'text' | 'search';
  className?: string; fk?: string; attrs?: Record<string, string>;
  onInput?: (v: string) => void; onEnter?: (v: string) => void; onClear?: () => void;
}): { el: HTMLElement; input: HTMLInputElement } {
  const input = h('input.k-input', {
    type: 'text', placeholder: o.placeholder ?? null, maxlength: o.maxlength ?? null, 'aria-label': o.label, spellcheck: 'false', autocomplete: 'off',
    'data-fk': o.fk ?? null, ...(o.attrs ?? {}),
  });
  input.value = o.value ?? '';
  const clear = o.onClear ? h('button.k-field-x', { type: 'button', title: 'Clear', 'aria-label': 'Clear', hidden: !input.value || null, onclick: () => { input.value = ''; clear!.hidden = true; o.onClear!(); input.focus(); } }, '✕') : null;
  input.addEventListener('input', () => { if (clear) clear.hidden = !input.value; o.onInput?.(input.value); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') o.onEnter?.(input.value); });
  const el = h('label.k-field', { class: o.className ?? null }, o.icon ?? null, input, clear);
  return { el, input };
}
