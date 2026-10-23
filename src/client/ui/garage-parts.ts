// Garage helpers: icons, labels, module stat summaries and a small modal dialog.

import { PARA_PER_STUN, PHANTOM_FIRE_REVEAL, REGEN_DELAY, SHIELD_DELAY, SHIELD_REGEN, SMOKE_AT, SMOKE_SIGHT, STEALTH_FIRE_REVEAL } from '../../shared/sim/battle.ts';
import { CLOAK_REVEAL } from '../../shared/types.ts';
import { h } from '../app.ts';
import { METERS_PER_CELL, fmtMeters } from '../../shared/grid.ts';
import { AP_TIERS, accuracyRating, apTier, damageKinds, firingStyle, turretTurnRate, weaponDps, type ApTier, type DamageKind } from '../../shared/stats.ts';
import { MELEE_SPRINT } from '../../shared/sim/battle.ts';
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
  // armour penetration: a hull plate, and an arrow that stops at it / gets halfway in / goes clean through
  apnone: '<path d="M14 4l6 2.2v5.6c0 4.4-2.6 7.4-6 8.2"/><path d="M14 4v16"/><path d="M2 12h8.5"/><path d="M7.5 9l3 3-3 3"/>',
  aphalf: '<path d="M14 4l6 2.2v5.6c0 4.4-2.6 7.4-6 8.2"/><path d="M14 4v5M14 15v5"/><path d="M2 12h14.5"/><path d="M13.5 9l3 3-3 3"/>',
  apfull: '<path d="M10 4l6 2.2v5.6c0 4.4-2.6 7.4-6 8.2"/><path d="M10 4v5M10 15v5"/><path d="M2 12h20"/><path d="M19 9l3 3-3 3"/>',
  // damage types
  kinetic: '<path d="M5 15.5l7.5-7.5 3.5 3.5-7.5 7.5z"/><path d="M12.5 8l3-3c1.4-1.4 3.5 0 3.5 0s1.4 2.1 0 3.5l-3 3"/><path d="M3 21l2-2"/>',
  explosive: '<path d="M12 2l1.8 5.2L19 5l-2.2 5.2L22 12l-5.2 1.8L19 19l-5.2-2.2L12 22l-1.8-5.2L5 19l2.2-5.2L2 12l5.2-1.8L5 5l5.2 2.2z"/>',
  energy: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  shield: '<path d="M12 3l8 3v6c0 4.8-3.4 8-8 9-4.6-1-8-4.2-8-9V6z"/><path d="M8 12l3 3 5-6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7"/><path d="M12 17h.01"/>',
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

/** footprint in cells, width × length ("2×3"); square by default */
export const sizeLabel = (s: number, w = s, l = s) => `${w}×${l}`;
/** size badge text for a design: "1×1 ×16" for squads, "2×3" for single units (footprint width × length) */
export const designSizeLabel = (st: { size: number; squad: number; fw?: number; fh?: number }) => (st.squad > 1 ? `${sizeLabel(st.size, st.fw, st.fh)} ×${st.squad}` : sizeLabel(st.size, st.fw, st.fh));
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

const DMG_KIND: Record<DamageKind, { label: string; desc: string }> = {
  kinetic: { label: 'Kinetic', desc: 'Kinetic (bullets, slugs, blades): no special armour counters it.' },
  explosive: { label: 'Explosive', desc: 'Explosive (shells, rockets, missiles, bombs): reactive armour cuts it by 75% for a few hits; point defense can shoot the round down.' },
  energy: { label: 'Energy', desc: 'Energy (lasers, beams, lightning, rails, flame, plasma): mirror coating reduces it.' },
};
const AP_SHORT: Record<ApTier, string> = { none: 'AP 0', half: 'AP ½', full: 'AP full' };

/** Armour-penetration badge: icon + tier, colour-coded (grey none / amber half / red full). */
export function apBadge(mod: ModuleDef, long = false): HTMLElement {
  const t = apTier(mod);
  const info = AP_TIERS[t];
  return h('span.g-ap', { class: `ap-${t}`, title: `${info.label}: ${info.desc} Shields are hit first and ignore penetration.` },
    icon(`ap${t}` as IconName), h('span', null, long ? info.label : AP_SHORT[t]));
}
/** Damage-type badge(s): kinetic / explosive / energy. */
export function damageKindBadges(mod: ModuleDef, long = false): HTMLElement {
  return h('span.g-dks', null, ...damageKinds(mod).map((k) =>
    h('span.g-dk', { class: `dk-${k}`, title: DMG_KIND[k].desc }, icon(k as IconName), long ? h('span', null, DMG_KIND[k].label) : null)));
}

/** "How damage works": the game's damage rules in one place (same numbers as the sim). */
export function showDamageRules(host: HTMLElement): void {
  const prevFocus = document.activeElement as HTMLElement | null;
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey, true); prevFocus?.focus?.(); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  const li = (ic: IconName, cls: string, title: string, text: string) => h('li', null, h('span.g-dr-ico', { class: cls }, icon(ic)), h('div', null, h('b', null, title), ' ', text));
  const box = h('div.g-modal.g-dmgrules', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'g-dr-title' },
    h('h3#g-dr-title', null, 'How damage works'),
    h('p.g-dr-sub', null, 'Every hit goes through these steps, in this order:'),
    h('ol.g-dr-steps', null,
      li('shield', 'sh', '1. Shields first.', `Shield modules and dome shields soak each hit at full strength. Armour and armour penetration don't matter against a shield. Shields recharge ${Math.round(SHIELD_REGEN * 100)}%/s after ${SHIELD_DELAY} s without damage, and while up they block burning, slow, disarm and knockback.`),
      li('armor', 'ar', '2. Then armour.', 'Whatever gets past the shield hits the hull. Armour takes a flat amount off every hit: armour 10 means -10 per hit (a hit never drops below 15% of its damage). Many small hits lose far more to armour than a few big ones, so machine guns struggle against tanks.'),
      li('apnone', 'ap-none', 'Armour penetration: 0 / ½ / full.', 'Each weapon either uses no penetration (full armour applies), half (ignores half the armour) or full (ignores all of it). Cannons, anti-tank missiles, rails and every melee weapon have full penetration.'),
      li('explosive', 'dk-explosive', 'Damage types.', 'Explosive (shells, rockets, missiles, bombs) is cut by reactive armour and can be shot down by point defense. Energy (lasers, beams, lightning, rails, flame, plasma) is reduced by mirror coating. Kinetic (bullets, blades) has no special counter.'),
      li('weapon', 'ml', 'Melee.', `Melee weapons ignore armour completely. Units armed only with melee weapons sprint ${Math.round((MELEE_SPRINT - 1) * 100)}% faster toward enemies to get through enemy fire.`),
    ),
    h('div.g-modal-btns', null, h('button.g-btn.primary', { type: 'button', onclick: close }, 'Got it')),
  );
  const back = h('div.g-modal-back', { onclick: (e: Event) => { if (e.target === back) close(); } }, box);
  host.append(back);
  document.addEventListener('keydown', onKey, true);
  (box.querySelector('button') as HTMLElement | null)?.focus();
}

/** Special-effect tags for a module (stun, burn, pierce...). */
export function moduleEffects(mod: ModuleDef): string[] {
  const t: string[] = [];
  if (mod.chain) t.push(`chain ${mod.chain}`);
  if (mod.pierce) t.push('pierce');
  if (mod.stun) t.push(`paralyse ${Math.round(mod.stun * PARA_PER_STUN)}`);
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
  if (mod.spinUp) t.push(`spin-up ${n1(mod.spinUp)}s`);
  if (mod.ramp) t.push(`focus ×${n1(mod.ramp)}`);
  if (mod.fireField) t.push(`fire field ${n1(mod.fireField.duration)}s`);
  if (mod.cluster) t.push(`cluster ×${mod.cluster.count}`);
  if (mod.minRange) t.push(`min rng ${fmtMeters(mod.minRange)}`);
  if (mod.rangeBonus) t.push(`+${Math.round(mod.rangeBonus * 100)}% unit range`);
  if (mod.spreadMult && mod.spreadMult < 1) t.push(`-${Math.round((1 - mod.spreadMult) * 100)}% spread`);
  return t;
}

/** Firing pattern + timing, e.g. "5-rd clip · 0.45 s/shot · 2.5 s reload", "Salvo ×4 · reloads 4.0 s",
 *  "Sustained · 20 rds/s", "Single shot · reloads 1.5 s". Base numbers (before fire-rate utilities / spin-up). */
export function firingText(mod: ModuleDef): string {
  if (mod.kind !== 'weapon') return '';
  const style = firingStyle(mod);
  const cd = mod.cooldown ?? 1;
  const clip = mod.magazine && mod.reload ? `${mod.magazine}-rd clip · ${secs(cd)}/shot · ${secs(mod.reload)} reload` : '';
  const spin = mod.spinUp ? ` · spin-up ${secs(mod.spinUp)}` : '';
  if (style === 'Salvo') {
    const n = (mod.burst ?? 1) * (mod.pellets ?? 1);
    return clip ? `Salvo ×${n} · ${clip}` : `Salvo ×${n} · reloads ${secs(cd)}`;
  }
  if (style === 'Clip') return clip;
  if (style === 'Sustained') return `Sustained · ${Math.round(1 / Math.max(0.05, cd))} rds/s${spin}`;
  return `Single shot · reloads ${secs(cd)}`;
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

const secs = (s: number) => `${s < 1 ? s.toFixed(2).replace(/0$/, '') : s.toFixed(1)} s`;

/** Compact key stats line for a module. */
export function moduleStats(mod: ModuleDef, withEffects = false): HTMLElement {
  const out = h('span.g-modstats');
  const stat = (k: string, v: string) => out.append(h('span.g-ms', null, h('b', null, v), ' ', k));
  if (mod.kind === 'weapon') {
    stat('dps', fmt(weaponDps(mod), 0));
    stat('rng', mod.minRange ? `${Math.round(mod.minRange * METERS_PER_CELL)}–${fmtMeters(mod.range ?? 0)}` : fmtMeters(mod.range ?? 0));
    const cd = mod.cooldown ?? 1;
    if (mod.magazine && mod.reload) stat('reload', secs(mod.reload));
    else if (firingStyle(mod) === 'Sustained') stat('rds/s', String(Math.round(1 / Math.max(0.05, cd))));
    else stat('reload', secs(cd));
    if (mod.splash) stat('AoE', fmtMeters(mod.splash));
    out.append(apBadge(mod), damageKindBadges(mod));
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
    if (mod.splash) extra.push(`AoE radius ${fmtMeters(mod.splash)}`);
    extra.push(AP_TIERS[apTier(mod)].label.toLowerCase(), damageKinds(mod).map((k) => DMG_KIND[k].label).join(' + ').toLowerCase() + ' damage');
    lines.push(extra.join(' · '));
    lines.push(`${firingText(mod)} · Accuracy ${accuracyLabel(mod) ?? accuracyRating(mod) + '/100'}`);
  }
  const trav = traverseDeg(mod);
  if (trav !== null) lines.push(`Traverse ${trav}°/s${trav < SLOW_TURRET_DEG ? ' (slow turret)' : ''}`);
  for (const rule of moduleRules(mod)) lines.push(`• ${rule}`);
  lines.push(`Weight ${mod.weight} · Complexity ${mod.cost} pts`);
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

/** Plain-language rules for a part: exactly what it does in battle, with the sim's own numbers. */
export function moduleRules(mod: ModuleDef): string[] {
  const r: string[] = [];
  const m = (cells: number) => fmtMeters(cells);
  if (mod.kind === 'weapon') {
    const tg = [mod.targetsGround ? 'ground units' : '', mod.targetsAir ? 'aircraft' : ''].filter(Boolean).join(' and ');
    r.push(`Hits ${tg || 'nothing'} up to ${m(mod.range ?? 0)} away${mod.minRange ? `, but nothing closer than ${m(mod.minRange)}` : ''}.`);
    r.push(`${firingText(mod)}.`);
    const dmg = `${mod.damage ?? 0}${mod.pellets && mod.pellets > 1 ? ` × ${mod.pellets} pellets` : ''}${mod.burst && mod.burst > 1 ? ` × ${mod.burst} per salvo` : ''}`;
    r.push(`Damage ${dmg} per shot.`);
    const tier = apTier(mod);
    r.push(`Armour penetration: ${tier === 'none' ? 'none (every hit loses the target\'s full armour value)' : tier === 'half' ? 'half (ignores half the target\'s armour)' : 'full (ignores the target\'s armour completely)'}. Shields are hit first and ignore penetration.`);
    r.push(damageKinds(mod).map((k) => DMG_KIND[k].desc).join(' '));
    if (mod.projectile === 'melee') r.push(`Melee: needs to reach its target. A unit armed only with melee weapons sprints ${Math.round((MELEE_SPRINT - 1) * 100)}% faster toward enemies.`);
    if (mod.splash) r.push(`Area damage: hurts every enemy within ${m(mod.splash)} of the impact.`);
    if (mod.projectile === 'missile') r.push('Homing: follows its target. Point defense can shoot it down; jammers break its lock.');
    else if (mod.projectile === 'rocket' || mod.projectile === 'shell' || mod.projectile === 'arc') r.push('Flies to where the target was when fired, so fast movers can dodge it. Point defense can shoot it down.');
    else if (mod.projectile === 'beam' || mod.projectile === 'lightning' || mod.projectile === 'rail') r.push('Hitscan: hits instantly, can\'t miss or be intercepted.');
    if (mod.pierce) r.push('Pierces: keeps going through every unit in its path.');
    if (mod.chain) r.push(`Chains to ${mod.chain} more nearby enemies.`);
    if (mod.falloff != null && mod.falloff < 1) r.push(`Damage falls off with distance: ${Math.round(mod.falloff * 100)}% at max range.`);
    if (mod.airBonus && mod.airBonus !== 1) r.push(`Deals ×${mod.airBonus} damage to aircraft.`);
    if (mod.spinUp) r.push(`Spin-up: starts at a quarter of its fire rate and reaches full rate after ${n1(mod.spinUp)} s of firing; winds down when idle.`);
    if (mod.ramp) r.push(`Focus: damage builds up to ×${n1(mod.ramp)} while it stays on one target; resets on a new target or a pause.`);
    if (mod.burn) r.push(`Sets the target burning: ${mod.burn.dps} dmg/s for ${mod.burn.duration} s (armor reduces it; shields and hardening block it).`);
    if (mod.fireField) r.push(`Leaves burning ground ${m(mod.fireField.radius)} across for ${mod.fireField.duration} s that sets enemy ground units on fire.`);
    if (mod.cluster) r.push(`Releases ${mod.cluster.count} bomblets (${mod.cluster.damage} dmg each) over ${m(mod.cluster.radius)} where it lands.`);
    if (mod.stun) r.push(`Paralyses: builds ${Math.round(mod.stun * PARA_PER_STUN)} paralysis per hit; when it passes the target's max HP the target is stunned. Shields soak it first.`);
    if (mod.slow) r.push(`Slows: each hit slows the target's movement and turning by up to ${Math.round(mod.slow * 100)}%.`);
    if (mod.disarm) r.push('Disarms: builds up per hit; past the target\'s max HP its weapons stop firing for a while.');
    if (mod.impulse) r.push(mod.impulse > 0 ? 'Knocks targets back (light units fly further than heavy ones).' : 'Pulls targets toward the shooter.');
  } else {
    if (mod.cloak === 'stealth') r.push(`Can't be targeted from range. Revealed while any enemy is within ${m(CLOAK_REVEAL)} of its hull, for ${STEALTH_FIRE_REVEAL} s after each shot it fires, and inside enemy sensor range.`);
    if (mod.cloak === 'phantom') r.push(`Can't be targeted at any distance. Revealed only for ${PHANTOM_FIRE_REVEAL} s after each shot it fires, and inside enemy sensor range.`);
    if (mod.detect) r.push(`Reveals cloaked enemies within ${m(mod.detect)} of this unit's hull, for your whole army.`);
    if (mod.shield) r.push(`Absorbs ${mod.shield} damage before the hull is hit; every hit drains it at full strength (armour and armour penetration don't matter against shields). While it's up, burning, slow, disarm and knockback are blocked and paralysis drains the shield instead. Recharges ${Math.round(SHIELD_REGEN * 100)}% per second after ${SHIELD_DELAY} s without damage.`);
    if (mod.shieldAura) r.push(`Gives every ally within ${m(mod.shieldAura.radius)} a ${mod.shieldAura.amount}-point shield (at most half that ally's HP). Domes don't stack.`);
    if (mod.fireRateAura) r.push(`Allies within ${m(mod.fireRateAura.radius)} fire ${Math.round(mod.fireRateAura.bonus * 100)}% faster. Doesn't stack.`);
    if (mod.heal) r.push(`Repairs the most damaged ally within ${m(mod.range ?? 0)} for ${mod.heal} HP/s.`);
    if (mod.pointDefense) r.push(`Shoots down an incoming rocket, missile or shell within ${m(mod.pointDefense.range)} every ${mod.pointDefense.cooldown} s (aimed at it or nearby allies).`);
    if (mod.jammer) r.push(`Enemy missiles aimed at it or allies within ${m(mod.jammer)} lose their lock; enemy guns are half as accurate against them. Doesn't stack.`);
    if (mod.smoke) r.push(`Below ${Math.round(SMOKE_AT * 100)}% HP, once per battle: smoke ${m(mod.smoke.radius)} around it for ${mod.smoke.duration} s. Units inside can only be targeted from within ${m(SMOKE_SIGHT)}.`);
    if (mod.reactive) r.push(`The next ${mod.reactive} shell, rocket or missile hits deal 75% less damage.`);
    if (mod.energyResist) r.push(`Takes ${Math.round(mod.energyResist * 100)}% less damage from beams, lightning, rails, plasma and flame.`);
    if (mod.hardened) r.push('Immune to paralysis/stun, slow, disarm, burning and knockback.');
    if (mod.regen) r.push(`Regenerates ${n1(mod.regen * 100)}% of max HP per second after ${REGEN_DELAY} s without taking damage.`);
    if (mod.rangeBonus) r.push(`All weapons on this unit reach ${Math.round(mod.rangeBonus * 100)}% further.`);
    if (mod.spreadMult && mod.spreadMult < 1) r.push(`Weapon spread ${Math.round((1 - mod.spreadMult) * 100)}% tighter.`);
    if (mod.speedBonus) r.push(`Moves ${Math.round(mod.speedBonus * 100)}% faster.`);
    if (mod.gyro) r.push('Every weapon can fire while moving.');
    if (mod.reloadBonus) r.push(`Clip weapons reload ${Math.round(mod.reloadBonus * 100)}% faster.`);
    if (mod.fireRateBonus) r.push(`All weapons fire ${Math.round(mod.fireRateBonus * 100)}% faster.`);
    if (mod.deathBlast) r.push(`When destroyed, explodes for ${mod.deathBlast.damage} damage up to ${m(mod.deathBlast.radius)} beyond its hull.`);
    if (mod.armor) r.push(`+${mod.armor} armour: every hit that reaches the hull loses that much damage. Half-penetration weapons ignore half of it, full-penetration weapons all of it; shields are hit before armour.`);
    if (mod.hp) r.push(`+${mod.hp} hull HP.`);
  }
  return r;
}
