// Small shared UI helpers for my screens: modals, confirm dialogs, deck cards.

import { h } from '../app.ts';
import * as kit from './kit.ts';
import { sfx } from '../audio.ts';
import { drawPartIcon, drawUnitPreview } from '../render/field.ts';
import { computeStats, firingStyle, levelMult, weaponDps } from '../../shared/stats.ts';
import { blockDims, fmtMeters, fmtSpeed } from '../../shared/grid.ts';
import { MODULE_BY_ID } from '../../shared/parts.ts';
import { START_DELAYS, STANCES, TARGET_PRIORITIES, type Design, type ModuleDef, type Side, type Size, type Stance, type TargetPriority, type UnitBehavior, type UnitStats } from '../../shared/types.ts';

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


// =============================================================================================
// Range rings + at-a-glance stat card
// =============================================================================================

export const RING_COLOR = { ground: '#f2a93b', air: '#5fc8ff', both: '#3fe0a8', support: '#b48cff' } as const;
export type RingKind = 'ground' | 'air' | 'both' | 'support';

export interface RingSpec {
  key: string;
  kind: RingKind;
  /** radius in cells */
  range: number;
  /** dead zone radius in cells (artillery) */
  minRange: number;
  color: string;
  /** "Howitzer 80 m" */
  label: string;
}

const mName = (m: ModuleDef) => m.name.replace(/^[\d.]+mm\s+/, '');
export const ringKey = (range: number, min: number, kind: RingKind) => `${kind}|${Math.round(range * 100)}|${Math.round(min * 100)}`;

/** One ring per distinct weapon range (melee shows as a tiny ring) plus support radii. Ranges include the unit's range multiplier. */
export function ringsOf(d: Design, st: UnitStats): RingSpec[] {
  const groups = new Map<string, RingSpec & { names: string[] }>();
  const add = (kind: RingKind, range: number, min: number, name: string) => {
    if (!(range > 0)) return;
    const key = ringKey(range, min, kind);
    const g = groups.get(key);
    if (g) { if (!g.names.includes(name)) g.names.push(name); return; }
    groups.set(key, { key, kind, range, minRange: min, color: RING_COLOR[kind], label: '', names: [name] });
  };
  for (const id of d.mounts) {
    const m = id ? MODULE_BY_ID.get(id) : undefined;
    if (!m) continue;
    if (m.kind === 'weapon' && m.range && !m.heal) { // melee reach is not scaled by range bonuses
      const g = !!m.targetsGround, a = !!m.targetsAir;
      add(g && a ? 'both' : a ? 'air' : 'ground', m.range * (m.projectile === 'melee' ? 1 : st.rangeMult), m.minRange ?? 0, mName(m));
    }
    if (m.heal && m.range) add('support', m.range * st.rangeMult, 0, mName(m));
    if (m.shieldAura) add('support', m.shieldAura.radius, 0, mName(m));
    if (m.fireRateAura) add('support', m.fireRateAura.radius, 0, mName(m));
    if (m.detect) add('support', m.detect, 0, mName(m));
    if (m.jammer) add('support', m.jammer, 0, mName(m));
    if (m.pointDefense) add('support', m.pointDefense.range, 0, mName(m));
  }
  return [...groups.values()].map(({ names, ...r }) => ({ ...r, label: `${names.length > 2 ? `${names[0]} +${names.length - 1}` : names.join(' + ')} ${fmtMeters(r.range)}` }));
}

/** Ring key of a module on a design (matches ringsOf) for hover-highlighting. */
export function moduleRingKey(m: ModuleDef, st: UnitStats): string | null {
  if (m.kind === 'weapon' && m.range && !m.heal) {
    const g = !!m.targetsGround, a = !!m.targetsAir;
    return ringKey(m.range * (m.projectile === 'melee' ? 1 : st.rangeMult), m.minRange ?? 0, g && a ? 'both' : a ? 'air' : 'ground');
  }
  if (m.heal && m.range) return ringKey(m.range * st.rangeMult, 0, 'support');
  const r = m.shieldAura?.radius ?? m.fireRateAura?.radius ?? m.detect ?? m.jammer ?? m.pointDefense?.range;
  return r ? ringKey(r, 0, 'support') : null;
}

/** Effective sustained dps of the whole unit against ground and air targets (0 = cannot hit). */
export function dpsSplit(d: Design, st: UnitStats, level = 1): { ground: number; air: number; weapons: number } {
  let fire = 1, ground = 0, air = 0, weapons = 0;
  const mods = d.mounts.map((id) => (id ? MODULE_BY_ID.get(id) : undefined)).filter((m): m is ModuleDef => !!m);
  for (const m of mods) fire += m.fireRateBonus ?? 0;
  for (const m of mods) {
    if (m.kind !== 'weapon' || !m.damage) continue;
    weapons++;
    const v = weaponDps(m) * fire * levelMult(level);
    if (m.targetsGround) ground += v;
    if (m.targetsAir) air += v * (m.airBonus ?? 1);
  }
  void st;
  return { ground, air, weapons };
}

const ICON_PATHS: Record<string, string> = {
  hp: '<path d="M12 20.500S3.500 15.500 3 9.500C2.800 6.500 5 4.500 7.500 4.500c1.900 0 3.400 1 4.500 2.600 1.100-1.600 2.600-2.600 4.500-2.600 2.500 0 4.700 2 4.500 5-.500 6-9 11-9 11z" fill="currentColor" stroke="none"/>',
  armor: '<path d="M12 3l8 3v6c0 5-3.500 8-8 9-4.500-1-8-4-8-9V6z" fill="currentColor" fill-opacity=".25"/><path d="M12 3v18"/>',
  shield: '<path d="M3 18a9 9 0 0 1 18 0z" fill="currentColor" fill-opacity=".25"/><path d="M8 13a5 5 0 0 1 4-4"/>',
  speed: '<path d="M5 6l6 6-6 6M12 6l6 6-6 6"/>',
  turn: '<path d="M20 12a8 8 0 1 1-3-6.200M20 4v4h-4"/>',
  range: '<circle cx="12" cy="12" r="6.500"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>',
  dps: '<path d="M13 2L4 14h7l-1 8 9-12h-7z" fill="currentColor" stroke="none"/>',
  ground: '<path d="M2 20l7-12 4 7 3-4 6 9z" fill="currentColor" fill-opacity=".3"/>',
  air: '<path d="M21 16v-2l-8-5V3.500a1.500 1.500 0 0 0-3 0V9l-8 5v2l8-2.500V19l-2 1.500V22l3.500-1 3.500 1v-1.500L13 19v-5.500z" fill="currentColor" stroke="none"/>',
  size: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  cost: '<circle cx="12" cy="12" r="8.500" fill="currentColor" fill-opacity=".2"/><circle cx="12" cy="12" r="4.500"/>',
  support: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8" stroke-dasharray="2 3"/>',
};
export function svgIcon(name: string, px = 18): HTMLElement {
  const s = document.createElement('span');
  s.className = `ico ico-${name}`;
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = `<svg viewBox="0 0 24 24" width="${px}" height="${px}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name] ?? ''}</svg>`;
  return s;
}

const n1 = (n: number) => String(Math.round(n * 10) / 10);
const dpsFmt = (n: number) => String(Math.round(n));

export interface StatCardOpts {
  design: Design;
  st: UnitStats;
  level?: number;
  spacing?: number;
  /** highlight a ring on the field while a weapon row is hovered */
  onRing?: (key: string | null) => void;
  /** pending upgrades shown in green */
  upgraded?: boolean;
}

/** The at-a-glance stat card: badges, big numbers, GND/AIR dps, weapon list. Shows only public data. */
export function statCard(o: StatCardOpts): HTMLElement {
  const { design: d, st } = o;
  const lv = o.level ?? 1, mult = levelMult(lv), squad = st.squad ?? 1;
  const dp = dpsSplit(d, st, lv);
  const tile = (icon: string, label: string, value: string, extra?: string | null, cls = '') =>
    h('div.sc-tile', { class: cls }, svgIcon(icon, 18), h('div.sc-tv', null, h('b', null, value), extra ? h('small', null, extra) : null), h('span.sc-tl', null, label));
  const hp = Math.round(st.hp * mult);
  const flags: HTMLElement[] = [];
  const fp = blockDims(st.size as Size, o.spacing ?? 0, st);
  flags.push(h('span.sc-badge.neutral', null, svgIcon('size', 14), `${sizeLabel(st.size)} · ${fmtMeters(fp.w)}×${fmtMeters(fp.h)}`));
  if (st.flying) flags.push(h('span.sc-badge.air', null, svgIcon('air', 14), 'FLYING'));
  else if (st.isStatic) flags.push(h('span.sc-badge.neutral', null, 'STATIC'));
  else flags.push(h('span.sc-badge.neutral', null, svgIcon('ground', 14), 'GROUND'));
  if (squad > 1) flags.push(h('span.sc-badge.squad', null, `SQUAD ×${squad}`));
  if (dp.weapons) {
    if (dp.air > 0 && dp.ground > 0) flags.push(h('span.sc-badge.aa', null, svgIcon('air', 14), 'ANTI-AIR'));
    else if (dp.air > 0) flags.push(h('span.sc-badge.aa', null, svgIcon('air', 14), 'ANTI-AIR ONLY'));
    else flags.push(h('span.sc-badge.noair', null, "CAN'T HIT AIR"));
    if (dp.ground <= 0) flags.push(h('span.sc-badge.noair', null, "CAN'T HIT GROUND"));
  } else flags.push(h('span.sc-badge.neutral', null, 'NO WEAPONS'));

  const dpsBox = (kind: 'ground' | 'air', v: number) => {
    const none = v <= 0;
    return h('div.sc-dps', { class: `${kind}${none ? (dp.weapons ? ' none' : ' na') : ''}` },
      svgIcon(kind, 20),
      h('div.sc-dv', null,
        h('span.sc-dl', null, `DPS vs ${kind === 'ground' ? 'GROUND' : 'AIR'}`),
        h('b', null, none ? '—' : dpsFmt(v)),
        squad > 1 && !none ? h('small', null, `per unit · block ${dpsFmt(v * squad)}`) : null),
    );
  };

  const tiles = h('div.sc-tiles', null,
    tile('hp', 'HP', String(hp), squad > 1 ? `×${squad}` : null, o.upgraded ? 'up' : ''),
    tile('armor', 'Armor', String(st.armor)),
    tile('shield', 'Shield', st.shield ? String(st.shield) : '—', null, st.shield ? '' : 'dim'),
    tile('speed', 'Speed', st.isStatic ? '—' : fmtSpeed(st.speed).replace(' m/s', ''), st.isStatic ? null : 'm/s', st.isStatic ? 'dim' : ''),
    tile('turn', 'Turn', st.isStatic ? '—' : String(Math.round((st.turn * 180) / Math.PI)), st.isStatic ? null : '°/s', st.isStatic ? 'dim' : ''),
    tile('range', 'Range', st.range ? String(Math.round(st.range * 5)) : '—', st.range ? 'm' : null, st.range ? '' : 'dim'),
  );

  const rows: HTMLElement[] = [];
  for (const id of d.mounts) {
    const m = id ? MODULE_BY_ID.get(id) : undefined;
    if (!m || m.kind === 'armor') continue;
    const key = moduleRingKey(m, st);
    const icon = document.createElement('canvas');
    icon.className = 'sc-icon';
    icon.setAttribute('aria-hidden', 'true');
    requestAnimationFrame(() => { try { drawPartIcon(icon, 'module', m.id, { backdrop: true }); } catch { /* */ } });
    const tags: string[] = [];
    let head: HTMLElement[] = [];
    if (m.kind === 'weapon' && m.damage) {
      const melee = m.projectile === 'melee';
      const range = (m.range ?? 0) * (melee ? 1 : st.rangeMult);
      const g = !!m.targetsGround, a = !!m.targetsAir;
      const dps = weaponDps(m) * mult;
      tags.push(firingStyle(m));
      if (m.splash) tags.push(`Splash ${fmtMeters(m.splash)}`);
      if (m.pierce) tags.push('Pierce');
      if (m.chain) tags.push(`Chain ×${m.chain}`);
      if (m.stun) tags.push(`Stun ${n1(m.stun)}s`);
      if (m.slow) tags.push(`Slow ${Math.round(m.slow * 100)}%`);
      if (m.disarm) tags.push(`Disarm ${n1(m.disarm)}s`);
      if (m.burn) tags.push(`Burn ${Math.round(m.burn.dps)}/s`);
      if (m.impulse) tags.push(m.impulse > 0 ? 'Knockback' : 'Pull');
      if (m.ap && m.ap >= 0.3) tags.push(`AP ${Math.round(m.ap * 100)}%`);
      if (a && m.airBonus && m.airBonus > 1) tags.push(`×${n1(m.airBonus)} vs air`);
      head = [
        h('span.sc-chip', { class: g ? 'g' : 'off' }, 'GND'),
        h('span.sc-chip', { class: a ? 'a' : 'off' }, 'AIR'),
        h('b.sc-wdps', null, `${dpsFmt(dps)}`, h('small', null, ' dps')),
      ];
      const sub = h('div.sc-wsub', null,
        h('span.sc-wr', null, melee ? `Melee ${fmtMeters(range)}` : `Range ${fmtMeters(range)}`, m.minRange ? h('span.min', null, ` · min ${fmtMeters(m.minRange)}`) : null),
        ...tags.map((t) => h('span.sc-tag', null, t)));
      rows.push(wRow(icon, m.name, head, sub, key, o.onRing, g && a ? 'both' : a ? 'air' : 'ground'));
    } else {
      const bits: string[] = [];
      if (m.heal) bits.push(`Repairs ${m.heal * mult | 0}/s · ${fmtMeters((m.range ?? 0) * st.rangeMult)}`);
      if (m.shield) bits.push(`Shield ${m.shield}`);
      if (m.shieldAura) bits.push(`Shield dome ${m.shieldAura.amount} · radius ${fmtMeters(m.shieldAura.radius)}`);
      if (m.fireRateAura) bits.push(`Allies +${Math.round(m.fireRateAura.bonus * 100)}% fire rate · ${fmtMeters(m.fireRateAura.radius)}`);
      if (m.detect) bits.push(`Detects cloaked · ${fmtMeters(m.detect)}`);
      if (m.jammer) bits.push(`Jams missiles · ${fmtMeters(m.jammer)}`);
      if (m.pointDefense) bits.push(`Shoots down shells/missiles · ${fmtMeters(m.pointDefense.range)}`);
      if (m.rangeBonus) bits.push(`Range +${Math.round(m.rangeBonus * 100)}%`);
      if (!bits.length) bits.push(m.desc.split(/(?<=[.;])\s/)[0]);
      const sub = h('div.sc-wsub', null, h('span.sc-wr', null, bits.join(' · ')));
      rows.push(wRow(icon, m.name, [h('span.sc-chip.sup', null, 'SUPPORT')], sub, key, o.onRing, 'support'));
    }
  }
  return h('div.sc', null,
    h('div.sc-badges', null, ...flags),
    tiles,
    h('div.sc-dpsrow', null, dpsBox('ground', dp.ground), dpsBox('air', dp.air)),
    rows.length ? h('div.sc-weps', null, ...rows) : null,
  );
}

function wRow(icon: HTMLElement, name: string, head: HTMLElement[], sub: HTMLElement, key: string | null, onRing: ((k: string | null) => void) | undefined, kind: RingKind): HTMLElement {
  const row = h('div.sc-w', { class: kind, tabindex: key ? '0' : null },
    icon,
    h('div.sc-wbody', null, h('div.sc-wtop', null, h('span.sc-wname', null, name), h('span.sc-wspace'), ...head), sub));
  if (key && onRing) {
    row.addEventListener('pointerenter', () => onRing(key));
    row.addEventListener('pointerleave', () => onRing(null));
    row.addEventListener('focus', () => onRing(key));
    row.addEventListener('blur', () => onRing(null));
  }
  return row;
}

/** One-line summary for the placement hint: HP · speed · range · GND dps · AIR dps. */
export function miniStats(d: Design, st: UnitStats, level = 1): HTMLElement {
  const dp = dpsSplit(d, st, level);
  const sq = st.squad > 1 ? h('span.ms-sq', null, `×${st.squad}`) : null;
  return h('div.ministats', null,
    h('span', null, svgIcon('hp', 15), h('b', null, String(Math.round(st.hp * levelMult(level)))), sq),
    h('span', null, svgIcon('speed', 15), h('b', null, st.isStatic ? 'static' : fmtSpeed(st.speed))),
    h('span', null, svgIcon('range', 15), h('b', null, st.range ? fmtMeters(st.range) : '—')),
    h('span.g', null, svgIcon('ground', 15), h('b', null, dp.ground > 0 ? dpsFmt(dp.ground) : '—')),
    dp.air > 0 ? h('span.a', null, svgIcon('air', 15), h('b', null, dpsFmt(dp.air))) : h('span.noair', null, svgIcon('air', 15), h('b', null, "NO AA")),
  );
}
