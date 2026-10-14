// Garage helpers: icons, labels, module stat summaries and a small modal dialog.

import { h } from '../app.ts';
import { METERS_PER_CELL, fmtMeters } from '../../shared/grid.ts';
import { accuracyRating, firingStyle, turretTurnRate, weaponDps } from '../../shared/stats.ts';
import { MOUNT_LETTER, ROLES } from '../../shared/parts.ts';
import type { ModuleDef, MoveKind, Role } from '../../shared/types.ts';
import { drawPartIcon, moduleCategoryColor, type PartKind } from '../render/field.ts';
import { CATEGORY_COLOR } from '../render/turrets.ts';

export { moduleCategoryColor, CATEGORY_COLOR };

const iconCache = new Map<string, HTMLCanvasElement>();

/** Part icon canvas of a fixed CSS size. Drawn once, after layout (icons are static); repeats reuse a cached bitmap. */
export function partIcon(kind: PartKind, id: string, size: number, backdrop = false): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.className = 'g-particon';
  c.style.width = c.style.height = `${size}px`;
  // square backing store from the start: if the icon paints while detached (the garage re-renders often), the
  // painter falls back to these dimensions instead of the canvas default 300x150, which used to squash icons
  const dpr = window.devicePixelRatio || 1;
  c.width = c.height = Math.round(size * dpr);
  c.setAttribute('aria-hidden', 'true');
  const key = `${kind}:${id}:${size}:${dpr}:${backdrop}`;
  const cached = iconCache.get(key);
  const paint = () => {
    if (cached) {
      c.width = cached.width; c.height = cached.height;
      c.getContext('2d')?.drawImage(cached, 0, 0);
      return;
    }
    try { drawPartIcon(c, kind, id, { backdrop }); } catch { return; }
    if (c.width !== c.height) return; // never cache a distorted paint
    const snap = document.createElement('canvas');
    snap.width = c.width; snap.height = c.height;
    snap.getContext('2d')?.drawImage(c, 0, 0);
    iconCache.set(key, snap);
  };
  requestAnimationFrame(paint);
  return c;
}

const ICONS: Record<string, string> = {
  ground: '<path d="M3 18h18"/><path d="M5 14h14l-2.5-5h-9z"/><path d="M10 9V6h6"/>',
  air: '<path d="M12 3v17"/><path d="M3 13l9-4 9 4"/><path d="M8.5 20.5L12 18l3.5 2.5"/>',
  static: '<path d="M5 21h14"/><path d="M8 21v-9h8v9"/><path d="M12 12V5h6"/>',
  weapon: '<circle cx="12" cy="12" r="6.5"/><path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5"/>',
  armor: '<path d="M12 3l8 3v6c0 4.8-3.4 8-8 9-4.6-1-8-4.2-8-9V6z"/>',
  utility: '<path d="M12 5v14M5 12h14"/><circle cx="12" cy="12" r="9"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M16 8V4H4v12h4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  spin: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>',
  save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
  undo: '<path d="M9 6L4 11l5 5"/><path d="M4 11h10a6 6 0 0 1 0 12h-3"/>',
  cost: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><circle cx="12" cy="12" r="3"/>',
  weight: '<path d="M7 9h10l3 11H4z"/><circle cx="12" cy="6" r="2.5"/>',
  deck: '<rect x="4" y="6" width="12" height="15" rx="1.5"/><path d="M8 3h11.5v15"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
};

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, cls = ''): HTMLSpanElement {
  const s = h('span.g-ico', { 'aria-hidden': 'true', class: cls || null });
  s.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return s;
}

export const TRAIT_LABEL: Record<string, string> = {
  rangeBoost: '+20% range',
  repairAura: 'Repair aura',
  airOnly: 'Airframe',
  compact: 'Compact',
  fireOnMove: 'Fires on move',
  evasive: 'Evasive',
  leap: 'Leaps',
  fortified: 'Fortified +15% range',
  stable: 'Stable aim',
  strafe: 'Strafing runs',
  crush: 'Crush',
};

export const KIND_LABEL: Record<MoveKind, string> = { ground: 'Ground', air: 'Air', static: 'Static' };

export const sizeLabel = (s: number) => `${s}×${s}`;
/** size badge text for a design: "1×1 ×16" for squads, "2×2" for single units */
export const designSizeLabel = (st: { size: number; squad: number }) => (st.squad > 1 ? `${sizeLabel(st.size)} ×${st.squad}` : sizeLabel(st.size));
/** Physical footprint of a size-N unit, e.g. 2 -> "10 m". */
export const footprintLabel = (s: number) => fmtMeters(s);

export function fmt(n: number, digits = 1): string {
  const r = Math.round(n * 10 ** digits) / 10 ** digits;
  return String(r);
}

/** Ground/air target badges for a weapon (or utility range). */
export function targetBadges(mod: ModuleDef): HTMLElement {
  const wrap = h('span.g-targets');
  if (mod.kind !== 'weapon') return wrap;
  wrap.append(
    h('span.g-tgt', { class: mod.targetsGround ? 'on' : 'off', title: mod.targetsGround ? 'Hits ground units' : "Can't hit ground units" }, icon('ground'), h('span.g-tgt-l', null, 'GND')),
    h('span.g-tgt', { class: mod.targetsAir ? 'on' : 'off', title: mod.targetsAir ? 'Hits aircraft' : "Can't hit aircraft" }, icon('air'), h('span.g-tgt-l', null, 'AIR')),
  );
  return wrap;
}

const n1 = (v: number) => (Math.round(v * 10) / 10).toString();

/** Special-effect tags for a module (stun, burn, pierce...). */
export function moduleEffects(mod: ModuleDef): string[] {
  const t: string[] = [];
  if (mod.chain) t.push(`chain ${mod.chain}`);
  if (mod.pierce) t.push('pierce');
  if (mod.stun) t.push(`stun ${mod.stun}s`);
  if (mod.slow) t.push(`slow ${Math.round(mod.slow * 100)}%`);
  if (mod.disarm) t.push(`Disarm ${n1(mod.disarm)}s`);
  if (mod.impulse) t.push(`${mod.impulse > 0 ? 'Knockback' : 'Pull'} ${fmtMeters(Math.abs(mod.impulse))}`);
  if (mod.detect) t.push(`Detect ${fmtMeters(mod.detect)}`);
  if (mod.shieldAura) t.push(`Shield aura ${fmtMeters(mod.shieldAura.radius)}`);
  if (mod.fireRateAura) t.push(`Fire-rate aura ${fmtMeters(mod.fireRateAura.radius)}`);
  if (mod.jammer) t.push(`Jam ${fmtMeters(mod.jammer)}`);
  if (mod.burn) t.push(`burn ${mod.burn.dps}/s ${mod.burn.duration}s`);
  if (mod.airBonus && mod.airBonus !== 1) t.push(`×${mod.airBonus} vs air`);
  if (mod.falloff != null && mod.falloff < 1) t.push('falloff');
  if (mod.minRange) t.push(`min rng ${fmtMeters(mod.minRange)}`);
  if (mod.rangeBonus) t.push(`+${Math.round(mod.rangeBonus * 100)}% unit range`);
  if (mod.spreadMult && mod.spreadMult < 1) t.push(`-${Math.round((1 - mod.spreadMult) * 100)}% spread`);
  return t;
}

/** Firing pattern text, e.g. "Clip: 6 rds, 2.0s reload", "Salvo ×4 every 4s", "Sustained". */
export function firingText(mod: ModuleDef): string {
  if (mod.kind !== 'weapon') return '';
  const style = firingStyle(mod);
  const cd = mod.cooldown ?? 1;
  const rds = mod.magazine && mod.reload ? `${mod.magazine} rds · ${mod.reload.toFixed(1)}s reload` : '';
  if (style === 'Salvo') {
    const n = (mod.burst ?? 1) * (mod.pellets ?? 1);
    return `Salvo ×${n} every ${cd.toFixed(1)}s${rds ? ` · ${rds}` : ''}`;
  }
  if (style === 'Clip') return `Clip · ${rds}`;
  if (style === 'Sustained') return 'Sustained';
  return `Single shot · ${cd.toFixed(1)}s`;
}

/** "Hitscan" / "Guided" label for perfect-accuracy weapons, else null. */
export function accuracyLabel(mod: ModuleDef): string | null {
  const p = mod.projectile;
  if (p === 'beam' || p === 'lightning' || p === 'rail') return 'Hitscan';
  if (p === 'missile' && accuracyRating(mod) >= 100) return 'Guided';
  return null;
}

/** Small accuracy meter. */
export function accuracyBar(mod: ModuleDef): HTMLElement {
  const a = accuracyRating(mod);
  const lbl = accuracyLabel(mod);
  const zone = a >= 80 ? 'hi' : a >= 55 ? 'mid' : 'lo';
  return h('span.g-acc', { class: zone, title: `Accuracy ${a}/100${lbl ? ` (${lbl.toLowerCase()})` : ''}`, role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(a), 'aria-label': 'Accuracy' },
    h('span.g-acc-l', null, 'acc'),
    h('span.g-acc-track', null, h('span.g-acc-fill', { style: { width: `${a}%` } })),
    h('b', null, lbl ?? String(a)),
  );
}

export const SLOW_TURRET_DEG = 60;
/** Turret traverse in deg/s, or null for modules without a turret (armor, non-healing utility). */
export function traverseDeg(mod: ModuleDef): number | null {
  if (mod.kind === 'armor' || (mod.kind === 'utility' && !mod.heal)) return null;
  return Math.round(turretTurnRate(mod) * 180 / Math.PI);
}

/** Compact key stats line for a module. */
export function moduleStats(mod: ModuleDef, withEffects = false): HTMLElement {
  const out = h('span.g-modstats');
  const stat = (k: string, v: string) => out.append(h('span.g-ms', null, h('b', null, v), ' ', k));
  if (mod.kind === 'weapon') {
    stat('dps', fmt(weaponDps(mod), 0));
    stat('rng', mod.minRange ? `${Math.round(mod.minRange * METERS_PER_CELL)}–${fmtMeters(mod.range ?? 0)}` : fmtMeters(mod.range ?? 0));
    if (mod.splash) stat('splash', fmtMeters(mod.splash));
    if (mod.ap) stat('ap', `${Math.round(mod.ap * 100)}%`);
    out.append(targetBadges(mod));
  } else if (mod.kind === 'armor') {
    if (mod.armor) stat('armor', `+${mod.armor}`);
    if (mod.hp) stat('hp', `+${mod.hp}`);
  } else {
    if (mod.heal) { stat('hp/s', fmt(mod.heal, 0)); stat('rng', fmtMeters(mod.range ?? 0)); }
    if (mod.shield) stat('shield', String(mod.shield));
    if (mod.hp) stat('hp', `+${mod.hp}`);
    if (mod.armor) stat('armor', `+${mod.armor}`);
  }
  const trav = traverseDeg(mod);
  if (trav !== null) {
    stat('traverse', `${trav}°/s`);
    if (trav < SLOW_TURRET_DEG) out.append(h('span.g-tag.slowturret', { title: `Turret traverse under ${SLOW_TURRET_DEG}°/s: slow to track moving targets` }, 'slow turret'));
  }
  if (withEffects && mod.kind === 'weapon') {
    out.append(h('span.g-fire', { title: 'Firing style' }, firingText(mod)), accuracyBar(mod));
  }
  if (withEffects) {
    const fx = moduleEffects(mod).filter((t) => !t.startsWith('min rng'));
    for (const t of fx) out.append(h('span.g-fx', null, t));
  }
  return out;
}

/** Plain-text tooltip for a module. */
export function moduleTooltip(mod: ModuleDef): string {
  const lines = [`${mod.name} (${mod.family}, size ${MOUNT_LETTER[mod.mount]}) — ${mod.desc}`];
  if (mod.kind === 'weapon') {
    const tg = [mod.targetsGround ? 'ground' : '', mod.targetsAir ? 'air' : ''].filter(Boolean).join(' + ');
    lines.push(`DPS ${fmt(weaponDps(mod), 0)} · Range ${mod.minRange ? Math.round(mod.minRange * METERS_PER_CELL) + '–' : ''}${fmtMeters(mod.range ?? 0)} · Targets ${tg}`);
    const extra: string[] = [`${mod.damage}${mod.pellets && mod.pellets > 1 ? '×' + mod.pellets : ''}${mod.burst && mod.burst > 1 ? ' ×' + mod.burst : ''} dmg / ${mod.cooldown}s`];
    if (mod.splash) extra.push(`splash ${fmtMeters(mod.splash)}`);
    if (mod.ap) extra.push(`${Math.round(mod.ap * 100)}% armor pierce`);
    lines.push(extra.join(' · '));
    lines.push(`${firingText(mod)} · Accuracy ${accuracyLabel(mod) ?? accuracyRating(mod) + '/100'}`);
  }
  const trav = traverseDeg(mod);
  if (trav !== null) lines.push(`Traverse ${trav}°/s${trav < SLOW_TURRET_DEG ? ' (slow turret)' : ''}`);
  const fx = moduleEffects(mod);
  if (fx.length) lines.push(fx.join(' · '));
  lines.push(`Weight ${mod.weight} · Base cost ${mod.cost}`);
  return lines.join('\n');
}

export interface ModalButton { id: string; label: string; kind?: 'primary' | 'danger' | 'ghost' }

/** Minimal accessible modal. Resolves with the clicked button id, or 'cancel' on Escape/backdrop. */
export function modal(host: HTMLElement, title: string, body: string, buttons: ModalButton[]): Promise<string> {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement as HTMLElement | null;
    const close = (v: string) => {
      back.remove();
      document.removeEventListener('keydown', onKey, true);
      prevFocus?.focus?.();
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close('cancel'); }
      if (e.key === 'Tab') {
        const f = [...box.querySelectorAll<HTMLElement>('button')];
        const i = f.indexOf(document.activeElement as HTMLElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    };
    const box = h('div.g-modal', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'g-modal-title' },
      h('h3#g-modal-title', null, title),
      h('p', null, body),
      h('div.g-modal-btns', null, ...buttons.map((b) =>
        h('button.g-btn', { type: 'button', class: b.kind ?? null, onclick: () => close(b.id) }, b.label))),
    );
    const back = h('div.g-modal-back', { onclick: (e: Event) => { if (e.target === back) close('cancel'); } }, box);
    host.append(back);
    document.addEventListener('keydown', onKey, true);
    (box.querySelector('button.primary') as HTMLElement ?? box.querySelector('button'))?.focus();
  });
}

// ---------------- role / size filters ----------------

const ROLE_COLOR: Record<Role, string> = {
  raider: '#ff8a5c', skirmisher: '#5cc8ff', riot: '#ff5c7a', assault: '#f2a93b', tank: '#9fb0c2', artillery: '#c58cff', antiair: '#7cf0ff',
  support: '#5cd66b', scout: '#d6e86a', flyer: '#8fa8ff', bomber: '#ff9bd0', siege: '#d8884a', stealth: '#a58cc9', melee: '#ff6b4a',
};
const ROLE_ICONS: Record<Role, string> = {
  raider: '<path d="M4 18l8-13 8 13-8-4z"/>',
  skirmisher: '<circle cx="12" cy="12" r="3"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/>',
  riot: '<circle cx="12" cy="12" r="3"/><path d="M12 4v3M12 17v3M4 12h3M17 12h3M6.3 6.3l2 2M15.7 15.7l2 2M17.7 6.3l-2 2M8.3 15.7l-2 2"/>',
  assault: '<path d="M5 19l7-14 7 14M8.5 13h7"/>',
  tank: '<path d="M12 3l8 3v6c0 4.8-3.4 8-8 9-4.6-1-8-4.2-8-9V6z"/>',
  artillery: '<path d="M4 19h16M7 19l6-11M13 8l3-3 3 3-3 3z"/>',
  antiair: '<path d="M12 21V8M7 12l5-6 5 6M5 21h14"/>',
  support: '<path d="M12 5v14M5 12h14"/><circle cx="12" cy="12" r="9"/>',
  scout: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3"/>',
  flyer: '<path d="M12 3v17M3 13l9-4 9 4"/>',
  bomber: '<path d="M12 3v7M9 10h6l1 5-4 6-4-6z"/>',
  siege: '<path d="M4 20V10l3-2 3 2v10M14 20V8l3-3 3 3v12M3 20h18"/>',
  stealth: '<path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z"/><path d="M4 4l16 16"/>',
  melee: '<path d="M5 19L18 6M14 4h6v6M7 17l-3 3"/>',
};
const ROLE_BY_ID = new Map(ROLES.map((r) => [r.id, r] as const));

export function roleIcon(id: Role): HTMLSpanElement {
  const s = h('span.g-ico', { 'aria-hidden': 'true' });
  s.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ROLE_ICONS[id]}</svg>`;
  return s;
}

/** Up to `max` small coloured role chips; roles currently selected in the filter come first. */
export function roleTags(roles: readonly Role[], max = 3): HTMLElement {
  const sorted = [...roles].sort((a, b) => Number(roleFilter.has(b)) - Number(roleFilter.has(a)));
  return h('span.g-rtags', null, ...sorted.slice(0, max).map((r) =>
    h('span.g-rtag', { class: roleFilter.has(r) ? 'hit' : null, style: { '--rc': ROLE_COLOR[r] }, title: ROLE_BY_ID.get(r)?.desc ?? r }, roleIcon(r), ROLE_BY_ID.get(r)?.name ?? r)));
}

const LS_ROLES = 'garage.roleFilter';
const LS_SIZES = 'garage.sizeFilter';
function loadSet<T>(key: string, ok: (v: unknown) => v is T): Set<T> {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]');
    if (Array.isArray(v)) return new Set(v.filter(ok));
  } catch { /* storage unavailable */ }
  return new Set();
}
function saveSet(key: string, s: Set<unknown>) {
  try { localStorage.setItem(key, JSON.stringify([...s])); } catch { /* ignore */ }
}
/** Shared role selection (OR). Empty = All. */
export const roleFilter: Set<Role> = loadSet<Role>(LS_ROLES, (v): v is Role => typeof v === 'string' && ROLE_BY_ID.has(v as Role));
export const sizeFilter: Set<number> = loadSet<number>(LS_SIZES, (v): v is number => typeof v === 'number' && v >= 1 && v <= 5);
export const SIZE_CLASSES = ['Light', 'Medium', 'Heavy', 'Giant', 'Titan'];

/** Does an item with these roles pass the shared role filter? */
export const matchesRoles = (roles: readonly Role[]) => roleFilter.size === 0 || roles.some((r) => roleFilter.has(r));
export const matchesSize = (size: number) => sizeFilter.size === 0 || sizeFilter.has(size);

/** Role chip bar (shared selection). `fk` namespaces focus keys; `onChange` re-renders. */
export function roleBar(fk: string, onChange: () => void, extra?: { sizes?: boolean }): HTMLElement {
  const toggle = (r: Role) => { if (roleFilter.has(r)) roleFilter.delete(r); else roleFilter.add(r); saveSet(LS_ROLES, roleFilter); onChange(); };
  const chip = (label: string, on: boolean, click: () => void, tip: string, key: string, color?: string, ico?: HTMLElement) =>
    h('button.g-rchip', { type: 'button', class: on ? 'on' : null, 'aria-pressed': String(on), title: tip, 'data-fk': `${fk}-${key}`, style: color ? { '--rc': color } : null, onclick: click }, ico ?? null, label);
  const bar = h('div.g-rbar', { role: 'group', 'aria-label': 'Filter by role' },
    h('div.g-rchips', null,
      h('span.g-rlabel', null, 'Role'),
      chip('All', roleFilter.size === 0, () => { roleFilter.clear(); saveSet(LS_ROLES, roleFilter); onChange(); }, 'Show every role', 'all'),
      ...ROLES.map((r) => chip(r.name, roleFilter.has(r.id), () => toggle(r.id), r.desc, r.id, ROLE_COLOR[r.id], roleIcon(r.id))),
    ),
  );
  if (extra?.sizes) {
    bar.append(h('div.g-rchips.sizes', { role: 'group', 'aria-label': 'Filter by size class' },
      h('span.g-rlabel', null, 'Size'),
      chip('Any', sizeFilter.size === 0, () => { sizeFilter.clear(); saveSet(LS_SIZES, sizeFilter); onChange(); }, 'Any size class', 'sz-all'),
      ...SIZE_CLASSES.map((n, i) => chip(n, sizeFilter.has(i + 1), () => {
        if (sizeFilter.has(i + 1)) sizeFilter.delete(i + 1); else sizeFilter.add(i + 1);
        saveSet(LS_SIZES, sizeFilter); onChange();
      }, `${n} chassis (size ${i + 1}, ${sizeLabel(i + 1)})`, `sz-${i + 1}`)),
    ));
  }
  if (roleFilter.size || (extra?.sizes && sizeFilter.size)) {
    const names = [...roleFilter].map((r) => ROLE_BY_ID.get(r)?.name ?? r);
    bar.append(h('div.g-ractive', { role: 'status' },
      h('span', null, 'Filtering: ', h('b', null, [...names, ...(extra?.sizes ? [...sizeFilter].sort().map((s) => SIZE_CLASSES[s - 1]) : [])].join(', ')),
        h('em', null, ' (shared by chassis, mobility and modules; selected part stays visible)')),
      h('button.g-rclear', { type: 'button', 'data-fk': `${fk}-clear`, onclick: () => { roleFilter.clear(); saveSet(LS_ROLES, roleFilter); if (extra?.sizes) { sizeFilter.clear(); saveSet(LS_SIZES, sizeFilter); } onChange(); } }, icon('x'), 'Clear filters'),
    ));
  }
  return bar;
}
