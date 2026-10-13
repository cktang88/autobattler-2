// Small shared UI helpers for my screens: modals, confirm dialogs, deck cards.

import { h } from '../app.ts';
import * as kit from './kit.ts';
import { sfx } from '../audio.ts';
import { drawUnitPreview } from '../render/field.ts';
import { computeStats } from '../../shared/stats.ts';
import { fmtMeters } from '../../shared/grid.ts';
import { MODULE_BY_ID } from '../../shared/parts.ts';
import { START_DELAYS, STANCES, TARGET_PRIORITIES, type Design, type Side, type Stance, type TargetPriority, type UnitBehavior } from '../../shared/types.ts';

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

// ---- battle AI settings: shared by the match screen (per block) and the garage (design defaults) ----
export const TARGET_INFO: Record<TargetPriority, { icon: string; label: string; tip: string }> = {
  closest: { icon: '◉', label: 'Closest', tip: 'Shoot the nearest enemy (default)' },
  farthest: { icon: '◌', label: 'Farthest', tip: 'Shoot the most distant enemy in range' },
  threat: { icon: '↩', label: 'Threat (retaliate)', tip: 'Shoot whoever last damaged this unit or its squad, else the closest' },
  lowestHp: { icon: '▾', label: 'Lowest HP', tip: 'Finish off the weakest enemy in range' },
  highestHp: { icon: '▴', label: 'Highest HP', tip: 'Focus the toughest enemy in range' },
  highestDps: { icon: '✶', label: 'Highest DPS', tip: 'Prioritise the enemy with the most damage output' },
  lowestDps: { icon: '✧', label: 'Lowest DPS', tip: 'Prioritise the enemy with the least damage output' },
  aircraft: { icon: '✈', label: 'Aircraft', tip: 'Aircraft first (falls back to ground targets)' },
  armored: { icon: '▣', label: 'Armored', tip: 'Highest armor first' },
  longestRange: { icon: '➶', label: 'Longest range', tip: 'Hunt artillery and snipers: longest weapon range first' },
  support: { icon: '✚', label: 'Support', tip: 'Repair, shields, uplinks, jammers and sensors first' },
  valuable: { icon: '◆', label: 'Most valuable', tip: 'Highest unit cost first' },
  swarm: { icon: '∴', label: 'Swarm', tip: 'Smallest / cheapest first: clear out swarms' },
};
export const STANCE_INFO: Record<Stance, { label: string; tip: string }> = {
  advance: { label: 'Advance', tip: 'Approach and engage (default)' },
  holdPos: { label: 'Hold position', tip: 'Never move: fire from where placed' },
  charge: { label: 'Charge', tip: 'Never stop to shoot: close to contact' },
  flankLeft: { label: 'Flank left', tip: 'Swing wide along your left side before turning in' },
  flankRight: { label: 'Flank right', tip: 'Swing wide along your right side before turning in' },
};
export type Orders = {
  target: TargetPriority; focus: boolean; stance: Stance; kite: boolean; hold: boolean; delay: number; retreat: boolean;
  /** mount index kiting keeps range to; -1 = longest-range weapon (default) */
  kiteMount: number;
};
export const DEFAULT_ORDERS: Orders = { target: 'closest', focus: false, stance: 'advance', kite: false, hold: false, delay: 0, retreat: false, kiteMount: -1 };
export const ordersOf = (b: UnitBehavior | undefined): Orders => ({
  target: b?.target && TARGET_PRIORITIES.includes(b.target) ? b.target : 'closest',
  focus: !!b?.focus,
  stance: b?.stance && STANCES.includes(b.stance) ? b.stance : 'advance',
  kite: !!b?.kite,
  hold: !!b?.hold,
  delay: (START_DELAYS as readonly number[]).includes(b?.delay ?? 0) ? (b?.delay ?? 0) : 0,
  retreat: !!b?.retreat,
  kiteMount: b?.kiteMount != null && b.kiteMount >= 0 ? b.kiteMount : -1,
});
export const ordersEqual = (a: Orders, b: Orders) => (Object.keys(DEFAULT_ORDERS) as (keyof Orders)[]).every((k) => a[k] === b[k]);
export const isCustomOrders = (o: Orders) => !ordersEqual(o, DEFAULT_ORDERS);
/** compact form: only non-default fields (what Placement / Design.behavior store) */
export const orderFields = (o: Orders): UnitBehavior => ({
  ...(o.target !== 'closest' ? { target: o.target } : {}),
  ...(o.focus ? { focus: true } : {}),
  ...(o.stance !== 'advance' ? { stance: o.stance } : {}),
  ...(o.kite ? { kite: true } : {}),
  ...(o.kite && o.kiteMount >= 0 ? { kiteMount: o.kiteMount } : {}),
  ...(o.hold ? { hold: true } : {}),
  ...(o.delay ? { delay: o.delay } : {}),
  ...(o.retreat ? { retreat: true } : {}),
});

export interface KiteOption { mount: number; label: string }
/** Ranged weapon mounts a kiting block can keep to; empty unless 2+ distinct ranges exist (melee excluded). */
export function kiteOptions(d: Design | undefined): KiteOption[] {
  if (!d) return [];
  const rm = safeStats(d)?.rangeMult ?? 1;
  const out: (KiteOption & { range: number })[] = [];
  d.mounts.forEach((id, i) => {
    const mod = id ? MODULE_BY_ID.get(id) : undefined;
    if (!mod || mod.kind !== 'weapon' || !mod.range || mod.projectile === 'melee') return;
    const range = mod.range * rm;
    out.push({ mount: i, range, label: `${mod.name} · ${fmtMeters(range)}` });
  });
  return new Set(out.map((o) => Math.round(o.range * 100))).size >= 2 ? out : [];
}

export interface EscortUi { label: string | null; picking: boolean; onPick(): void; onClear(): void }

/** Compact battle-AI panel. Targeting (priority + focus fire) / Movement (stance, kite, keep spread, delay, retreat, escort). */
export function ordersControl(o: Orders, squad: boolean, on: (patch: Partial<Orders>) => void,
  opts: { custom?: boolean; escort?: EscortUi; kiteOptions?: KiteOption[] } = {}): HTMLElement {
  const chip = (label: string, tip: string, v: boolean, key: keyof Orders) =>
    kit.toggle({ label, on: v, title: tip, className: `ord-${String(key)}`, onChange: (nv) => on({ [key]: nv }) });
  const tgt = kit.select({
    value: o.target, label: 'Targeting priority', title: TARGET_INFO[o.target].tip, className: 'ord-sel',
    options: TARGET_PRIORITIES.map((t) => ({ value: t, label: TARGET_INFO[t].label, icon: TARGET_INFO[t].icon, hint: TARGET_INFO[t].tip })),
    onChange: (v) => on({ target: v }),
  });
  const stance = kit.select({
    value: o.stance, label: 'Stance', title: STANCE_INFO[o.stance].tip, className: 'ord-sel',
    options: STANCES.map((t) => ({ value: t, label: STANCE_INFO[t].label, hint: STANCE_INFO[t].tip })),
    onChange: (v) => on({ stance: v }),
  });
  const esc = opts.escort;
  const ko = opts.kiteOptions ?? [];
  const kiteSel = o.kite && ko.length >= 2 ? h('div.ord-row', null, h('span', null, 'Kite with'), kit.select({
    value: String(ko.some((k) => k.mount === o.kiteMount) ? o.kiteMount : -1), label: 'Kite with', className: 'ord-sel',
    title: 'Which weapon\'s range to keep to while kiting',
    options: [{ value: '-1', label: 'Longest range (default)' }, ...ko.map((k) => ({ value: String(k.mount), label: k.label }))],
    onChange: (v) => on({ kiteMount: Number(v) }),
  })) : null;
  return h('div.orders', null,
    h('div.sp-head', null, h('span', null, 'Battle orders'), opts.custom !== false && isCustomOrders(o) ? h('span.custom-tag', { title: 'Differs from the default orders' }, 'custom') : null),
    h('div.ord-group', null,
      h('div.ord-title', null, 'Targeting'),
      h('div.ord-row', null, tgt, chip('Focus fire', 'Prefer the target nearby allies are already shooting', o.focus, 'focus')),
    ),
    h('div.ord-group', null,
      h('div.ord-title', null, 'Movement'),
      h('div.ord-row', null, stance),
      h('div.ord-row.chips', null,
        chip('Kite', 'Stay at maximum weapon range and back away from enemies that close in', o.kite, 'kite'),
        squad ? chip('Keep spread', 'Squad units hold their deployed spacing while moving', o.hold, 'hold') : null,
        chip('Retreat', 'Below 30% HP fall back toward your lines or repair; return above 70%', o.retreat, 'retreat'),
      ),
      kiteSel,
      h('div.hold-row', null,
        h('span', { title: 'Wait before moving; weapons still fire at anything in range' }, 'Start delay'),
        kit.segmented({ value: o.delay, label: 'Start delay', className: 'full', options: START_DELAYS.map((d) => ({ value: d, label: d ? `${d}s` : 'None' })), onChange: (d) => on({ delay: d }) }),
      ),
      esc ? h('div.ord-row.escort', null,
        kit.toggle({ label: esc.picking ? 'Click a friendly block…' : 'Escort…', on: esc.picking, title: 'Pick a friendly block to stay close to and protect', onChange: () => esc.onPick() }),
        esc.label ? h('span.esc-label', null, `→ ${esc.label}`, h('button.k-x', { type: 'button', title: 'Stop escorting', 'aria-label': 'Stop escorting', onclick: () => esc.onClear() }, '✕')) : null,
      ) : null,
    ),
  );
}
