// Garage: design units from chassis + mobility + mount modules, manage the collection and deck.

import { h } from '../app.ts';
import type { ScreenFn } from '../app.ts';
import { sfx } from '../audio.ts';
import { kiteOptions, ordersControl, ordersOf, orderFields } from './match-ui.ts';
import { activeDeck, allDesigns, deleteDesign, newDesignId, saveDesign, setDeck } from '../collection.ts';
import { drawUnitPreview } from '../render/field.ts';
import { METERS_PER_CELL, fmtMeters } from '../../shared/grid.ts';
import { DECK_SIZE } from '../../shared/match.ts';
import { CATEGORIES, CHASSIS, CHASSIS_BY_ID, MOBILITY, MOBILITY_BY_ID, MODULES, MODULE_BY_ID, fitsMount, pairingError, MOUNT_RANK } from '../../shared/parts.ts';
import { MAX_LOAD, PARTS_WEIGHT, POWER_K, computeStats, loadSpeedFactor, validateDesign } from '../../shared/stats.ts';
import type { ChassisDef, Design, MountClass, UnitStats } from '../../shared/types.ts';
import { KIND_LABEL, TRAIT_LABEL, fmt, icon, modal, moduleCategoryColor, moduleStats, moduleTooltip, partIcon, sizeLabel, designSizeLabel, footprintLabel, CATEGORY_COLOR } from './garage-parts.ts';

const RANK: Record<MountClass, number> = MOUNT_RANK;
const NAME_MAX = 24;
/** Weight bar spans 0..BAR_MAX load. */
const BAR_MAX = 1.8;

const clone = (d: Design): Design => ({ id: d.id, name: d.name, chassis: d.chassis, mobility: d.mobility, mounts: [...d.mounts], ...(d.behavior ? { behavior: { ...d.behavior } } : {}) });
const same = (a: Design, b: Design) =>
  a.name === b.name && a.chassis === b.chassis && a.mobility === b.mobility &&
  JSON.stringify(a.behavior ?? {}) === JSON.stringify(b.behavior ?? {}) &&
  a.mounts.length === b.mounts.length && a.mounts.every((m, i) => (m ?? null) === (b.mounts[i] ?? null));

function statsOf(d: Design): UnitStats | null {
  try { return computeStats(d); } catch { return null; }
}

const firstLegalMobility = (chassisId: string) => MOBILITY.find((m) => !pairingError(chassisId, m.id))?.id ?? MOBILITY[0].id;

/** Re-seat modules onto a new chassis: biggest modules first, each into the smallest free slot that fits. */
function reseat(mods: (string | null)[], c: ChassisDef): (string | null)[] {
  const out: (string | null)[] = c.mounts.map(() => null);
  const list = mods.filter((m): m is string => !!m && MODULE_BY_ID.has(m))
    .sort((a, b) => RANK[MODULE_BY_ID.get(b)!.mount] - RANK[MODULE_BY_ID.get(a)!.mount]);
  const slots = c.mounts.map((cls, i) => ({ cls, i })).sort((a, b) => RANK[a.cls] - RANK[b.cls]);
  for (const id of list) {
    const mod = MODULE_BY_ID.get(id)!;
    const s = slots.find((s) => out[s.i] === null && fitsMount(s.cls, mod.mount));
    if (s) out[s.i] = id;
  }
  return out;
}

function blankDesign(n: number): Design {
  const c = CHASSIS_BY_ID.get('raider') ?? CHASSIS[0];
  const weapon = MODULES.find((m) => m.kind === 'weapon' && fitsMount(c.mounts[0], m.mount))!;
  return {
    id: newDesignId(), name: `Prototype ${n}`, chassis: c.id, mobility: firstLegalMobility(c.id),
    mounts: c.mounts.map((_, i) => (i === 0 ? weapon.id : null)),
  };
}

export const garageScreen: ScreenFn<{ name: 'garage' }> = (app) => {
  // ---------------- state ----------------
  let designs = allDesigns();
  let deck = activeDeck().map((d) => d.id);
  let selectedId: string | null = designs[0]?.id ?? null;
  let saved: Design | null = designs[0] ? clone(designs[0]) : null;
  let draft: Design = saved ? clone(saved) : blankDesign(1);
  let openSlot: number | null = null;
  let pickerCat: string | null = null;
  let spin = true;
  let angle = -Math.PI / 2;
  let lastT = 0;
  let destroyed = false;

  const dirty = () => !saved || !same(saved, draft);

  // ---------------- static skeleton ----------------
  const deckChip = h('span.g-deckchip', { role: 'status', 'aria-live': 'polite' });
  const listEl = h('div.g-items', { role: 'list' });
  const preview = h('canvas.g-preview', { 'aria-label': 'Unit preview', role: 'img' });
  const previewTags = h('div.g-prev-tags');
  const previewCost = h('div.g-prev-cost');
  const spinBtn = h('button.g-iconbtn.g-spin', { type: 'button', title: 'Toggle rotation', 'aria-label': 'Toggle rotation', onclick: () => { spin = !spin; sfx('click'); syncSpin(); } }, icon('spin'));
  const nameInput = h('input.g-name', { type: 'text', maxlength: NAME_MAX, 'aria-label': 'Design name', spellcheck: 'false', autocomplete: 'off' });
  const saveBtn = h('button.g-btn.primary', { type: 'button', onclick: () => doSave() }, icon('save'), 'Save');
  const revertBtn = h('button.g-btn.ghost', { type: 'button', title: 'Revert to saved', onclick: () => revert() }, icon('undo'), 'Revert');
  const errorsEl = h('ul.g-errors', { 'aria-live': 'polite' });
  const statsEl = h('div.g-stats');
  const loadEl = h('div.g-load');
  const costEl = h('div.g-cost');
  const chassisEl = h('div.g-cards.g-chassis-cards', { role: 'group', 'aria-label': 'Chassis' });
  const mobilityEl = h('div.g-cards.g-mob-cards', { role: 'group', 'aria-label': 'Mobility' });
  const mountsEl = h('div.g-mounts');
  const aiEl = h('div.g-ai');
  const listCanvases: { c: HTMLCanvasElement; get: () => Design }[] = [];

  nameInput.addEventListener('input', () => {
    draft.name = nameInput.value.slice(0, NAME_MAX);
    update();
  });

  const step = (n: string, title: string, sub: string, body: HTMLElement) =>
    h('section.g-step', null, h('header.g-step-h', null, h('span.g-step-n', null, n), h('h2', null, title), h('span.g-step-sub', null, sub)), body);

  const el = h('div.garage', null,
    h('header.g-top', null,
      h('button.g-btn.ghost.g-back', { type: 'button', onclick: () => leave() }, icon('back'), 'Menu'),
      h('h1.g-title', null, 'Garage', h('span', null, 'Design bureau')),
      deckChip,
    ),
    h('div.g-body', null,
      h('aside.g-list', { 'aria-label': 'Your designs' },
        h('div.g-list-h', null,
          h('h2', null, 'Designs'),
          h('div.g-list-btns', null,
            h('button.g-iconbtn', { type: 'button', title: 'New design', 'aria-label': 'New design', onclick: () => newDesign() }, icon('plus')),
            h('button.g-iconbtn', { type: 'button', title: 'Duplicate', 'aria-label': 'Duplicate design', onclick: () => duplicate() }, icon('copy')),
            h('button.g-iconbtn.danger', { type: 'button', title: 'Delete', 'aria-label': 'Delete design', onclick: () => remove() }, icon('trash')),
          ),
        ),
        listEl,
      ),
      h('div.g-main', null,
      h('section.g-center', null,
        h('div.g-stage', null,
          preview,
          h('div.g-stage-hud', null, previewTags, spinBtn),
          previewCost,
          h('div.g-stage-hint', null, 'drag to rotate'),
        ),
        h('div.g-namebar', null, nameInput, revertBtn, saveBtn),
        errorsEl,
        statsEl,
        loadEl,
        costEl,
      ),
      h('section.g-parts', null,
        step('01', 'Chassis', 'Hull size, armor and mount slots', chassisEl),
        step('02', 'Mobility', 'Weight capacity sets speed', mobilityEl),
        step('03', 'Loadout', 'A slot takes its class or smaller', mountsEl),
        step('04', 'Battle AI defaults', 'New blocks start with these orders; change them per block on the field', aiEl),
      ),
      ),
    ),
  );

  // ---------------- preview: drag to rotate ----------------
  let drag: { x: number; a: number } | null = null;
  preview.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, a: angle }; preview.setPointerCapture(e.pointerId); spin = false; syncSpin(); });
  preview.addEventListener('pointermove', (e) => { if (drag) angle = drag.a + (e.clientX - drag.x) * 0.012; });
  const endDrag = () => { drag = null; };
  preview.addEventListener('pointerup', endDrag);
  preview.addEventListener('pointercancel', endDrag);
  function syncSpin() {
    spinBtn.classList.toggle('on', spin);
    spinBtn.setAttribute('aria-pressed', String(spin));
  }

  // ---------------- actions ----------------
  async function guard(): Promise<boolean> {
    if (!dirty()) return true;
    const valid = validateDesign(draft).length === 0;
    const btns = [
      ...(valid ? [{ id: 'save', label: 'Save', kind: 'primary' as const }] : []),
      { id: 'discard', label: 'Discard', kind: 'danger' as const },
      { id: 'cancel', label: 'Keep editing', kind: 'ghost' as const },
    ];
    const r = await modal(el, 'Unsaved changes', `"${draft.name || 'Untitled'}" has unsaved changes${valid ? '' : ' (and is not legal yet, so it cannot be saved)'}.`, btns);
    if (r === 'save') return doSave();
    return r === 'discard';
  }

  function load(d: Design | null) {
    selectedId = d?.id ?? null;
    saved = d ? clone(d) : null;
    draft = d ? clone(d) : blankDesign(designs.length + 1);
    openSlot = null;
    nameInput.value = draft.name;
    update();
    listEl.querySelector('.g-item.sel')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  async function select(id: string) {
    if (id === selectedId) return;
    if (!(await guard())) return;
    sfx('click');
    load(designs.find((d) => d.id === id) ?? null);
  }

  async function newDesign() {
    if (!(await guard())) return;
    sfx('click');
    load(null);
    nameInput.focus();
    nameInput.select();
  }

  async function duplicate() {
    const src = clone(draft);
    if (!(await guard())) return;
    sfx('click');
    const base = src.name.replace(/\s+Mk\s*\d+$/i, '');
    let n = 2;
    const names = new Set(designs.map((d) => d.name));
    let name = `${base} Mk${n}`.slice(0, NAME_MAX);
    while (names.has(name) && n < 99) name = `${base.slice(0, NAME_MAX - 5)} Mk${++n}`;
    load(null);
    draft = { ...src, id: newDesignId(), name, mounts: [...src.mounts], ...(src.behavior ? { behavior: { ...src.behavior } } : {}) };
    nameInput.value = draft.name;
    update();
    app.toast(`Duplicated as "${name}" — save to keep it`);
  }

  async function remove() {
    if (!saved || selectedId === null) {
      // unsaved draft: just drop it
      sfx('click');
      load(designs[0] ?? null);
      return;
    }
    if (designs.length <= 1) { sfx('error'); app.toast('Keep at least one design', 'error'); return; }
    const r = await modal(el, 'Delete design?', `"${saved.name}" will be scrapped for good.`, [
      { id: 'del', label: 'Delete', kind: 'danger' },
      { id: 'cancel', label: 'Cancel', kind: 'ghost' },
    ]);
    if (r !== 'del') return;
    const idx = designs.findIndex((d) => d.id === selectedId);
    deleteDesign(selectedId);
    designs = allDesigns();
    deck = activeDeck().map((d) => d.id);
    sfx('click');
    load(designs[Math.min(idx, designs.length - 1)] ?? null);
  }

  function doSave(): boolean {
    const errs = validateDesign(draft);
    if (errs.length) { sfx('error'); app.toast(errs[0], 'error'); return false; }
    draft.name = draft.name.trim();
    const isNew = !designs.some((d) => d.id === draft.id);
    if (!saveDesign(draft)) { sfx('error'); app.toast('Could not save design', 'error'); return false; }
    designs = allDesigns();
    let msg = `Saved "${draft.name}"`;
    if (isNew && deck.length < DECK_SIZE && !deck.includes(draft.id)) {
      deck = [...deck, draft.id];
      setDeck(deck);
      msg += ' · added to deck';
    }
    deck = activeDeck().map((d) => d.id);
    selectedId = draft.id;
    saved = clone(draft);
    nameInput.value = draft.name;
    sfx('upgrade');
    app.toast(msg, 'good');
    update();
    return true;
  }

  function revert() {
    if (!saved) return;
    sfx('click');
    draft = clone(saved);
    nameInput.value = draft.name;
    update();
  }

  function toggleDeck(id: string) {
    if (deck.includes(id)) {
      if (deck.length <= 1) { sfx('error'); app.toast('Your deck needs at least one design', 'error'); return; }
      deck = deck.filter((x) => x !== id);
    } else {
      if (deck.length >= DECK_SIZE) { sfx('error'); app.toast(`Deck is full (${DECK_SIZE} max)`, 'error'); return; }
      deck = [...deck, id];
    }
    setDeck(deck);
    deck = activeDeck().map((d) => d.id);
    sfx('click');
    update();
  }

  async function leave() {
    if (!(await guard())) return;
    sfx('click');
    app.go({ name: 'menu' });
  }

  function pickChassis(id: string) {
    if (id === draft.chassis) return;
    const c = CHASSIS_BY_ID.get(id)!;
    const mobility = pairingError(id, draft.mobility) ? firstLegalMobility(id) : draft.mobility;
    draft = { ...draft, chassis: id, mobility, mounts: reseat(draft.mounts, c) };
    openSlot = null;
    sfx('click');
    update();
  }

  function pickMobility(id: string) {
    const err = pairingError(draft.chassis, id);
    if (err) { sfx('error'); app.toast(err, 'error'); return; }
    if (id === draft.mobility) return;
    draft = { ...draft, mobility: id };
    sfx('click');
    update();
  }

  /** why a module can't be picked with the current mobility (null = fine) */
  function reqReason(mod: { requires?: 'air' | 'ground' }): string | null {
    if (!mod.requires) return null;
    const flies = MOBILITY_BY_ID.get(draft.mobility)?.kind === 'air';
    if (mod.requires === 'air' && !flies) return 'Flying designs only';
    if (mod.requires === 'ground' && flies) return 'Ground designs only';
    return null;
  }

  function pickModule(slot: number, id: string | null) {
    const mounts = [...draft.mounts];
    mounts[slot] = id;
    draft = { ...draft, mounts };
    openSlot = null;
    sfx('click');
    update();
  }

  // ---------------- rendering ----------------
  function update() {
    const fk = (document.activeElement as HTMLElement | null)?.dataset?.fk;
    renderHeader();
    renderList();
    renderCenter();
    renderChassis();
    renderMobility();
    renderMounts();
    renderAI();
    if (fk) (el.querySelector(`[data-fk="${fk}"]`) as HTMLElement | null)?.focus();
  }

  function renderAI() {
    const sq = (statsOf(draft)?.squad ?? 1) > 1;
    const ko = kiteOptions(draft);
    const o0 = ordersOf(draft.behavior);
    // drop a kite weapon that no longer exists in the loadout
    const o = ko.some((k) => k.mount === o0.kiteMount) ? o0 : { ...o0, kiteMount: -1 };
    if (o.kiteMount !== o0.kiteMount) {
      const b = orderFields({ ...o, hold: sq && o.hold });
      const { behavior: _b, ...rest } = draft;
      draft = Object.keys(b).length ? { ...rest, behavior: b } : rest;
    }
    aiEl.replaceChildren(ordersControl({ ...o, hold: sq && o.hold }, sq, (patch) => {
      const next = { ...o, ...patch };
      const b = orderFields({ ...next, hold: sq && next.hold });
      const { behavior: _b, ...rest } = draft;
      draft = Object.keys(b).length ? { ...rest, behavior: b } : rest;
      sfx('click');
      update();
    }, { custom: false, kiteOptions: ko }));
  }

  function renderHeader() {
    deckChip.replaceChildren(icon('deck'), 'Deck ', h('b', null, String(deck.length)), `/${DECK_SIZE}`);
    deckChip.classList.toggle('full', deck.length >= DECK_SIZE);
  }

  function listItem(d: Design, opts: { selected: boolean; unsaved: boolean; isDraft: boolean }) {
    const s = statsOf(d);
    const inDeck = deck.includes(d.id);
    const canvas = h('canvas.g-mini', { 'aria-hidden': 'true' });
    listCanvases.push({ c: canvas, get: () => (opts.selected ? draft : d) });
    const toggle = opts.isDraft
      ? h('span.g-decktog.na', { title: 'Save to add to deck' }, 'new')
      : h('button.g-decktog', {
        type: 'button', class: inDeck ? 'in' : null, 'aria-pressed': String(inDeck), 'data-fk': `deck-${d.id}`,
        title: inDeck ? 'In deck — click to remove' : 'Add to deck', 'aria-label': `${inDeck ? 'Remove' : 'Add'} ${d.name} ${inDeck ? 'from' : 'to'} deck`,
        onclick: (e: Event) => { e.stopPropagation(); toggleDeck(d.id); },
      }, icon(inDeck ? 'check' : 'plus'), h('span', null, 'Deck'));
    return h('div.g-item', { role: 'listitem', class: [opts.selected ? 'sel' : '', inDeck ? 'indeck' : ''].join(' ') },
      h('button.g-item-main', {
        type: 'button', 'data-fk': `item-${d.id}`, 'aria-current': opts.selected ? 'true' : null,
        onclick: () => (opts.isDraft ? undefined : select(d.id)),
      },
      canvas,
      h('span.g-item-txt', null,
        h('span.g-item-name', null, d.name || 'Untitled', opts.unsaved ? h('i.g-dot', { title: 'Unsaved changes' }) : null),
        h('span.g-item-meta', null,
          h('span.g-size', null, s ? designSizeLabel(s) : '?'),
          h('span.g-item-cost', { title: s && s.squad > 1 ? `Block of ${s.squad} (${s.unitCost} per unit)` : 'Supply price' }, icon('cost'), s ? String(s.cost) : '–'),
          s?.flying ? h('span.g-tag.air', null, 'AIR') : null,
          s?.isStatic ? h('span.g-tag.static', null, 'FIX') : null,
        ),
      )),
      toggle,
    );
  }

  function renderList() {
    listCanvases.length = 0;
    const items: HTMLElement[] = [];
    if (selectedId === null) items.push(listItem(draft, { selected: true, unsaved: true, isDraft: true }));
    for (const d of designs) {
      const sel = d.id === selectedId;
      items.push(listItem(sel ? draft : d, { selected: sel, unsaved: sel && dirty(), isDraft: false }));
    }
    if (!items.length) items.push(h('p.g-empty', null, 'No designs yet.'));
    listEl.replaceChildren(...items);
  }

  const deg = (rad: number) => Math.round(rad * 180 / Math.PI);
  function statTile(label: string, value: string, delta: number | null, opts: { unit?: string; invert?: boolean; digits?: number; cls?: string } = {}) {
    let d: HTMLElement | null = null;
    if (delta !== null && Math.abs(delta) > 1e-6) {
      const good = opts.invert ? delta < 0 : delta > 0;
      d = h('span.g-delta', { class: good ? 'up' : 'down' }, `${delta > 0 ? '+' : ''}${fmt(delta, opts.digits ?? 0)}`);
    }
    return h('div.g-stat', { class: opts.cls ?? null }, h('span.g-stat-l', null, label), h('span.g-stat-v', null, value, opts.unit ? h('small', null, opts.unit) : null, d));
  }

  function renderCenter() {
    const s = statsOf(draft);
    const ss = saved && dirty() ? statsOf(saved) : null;
    const errs = validateDesign(draft);
    const isDirty = dirty();
    saveBtn.disabled = errs.length > 0 || !isDirty;
    saveBtn.title = errs.length ? errs[0] : isDirty ? 'Save design (Ctrl+S)' : 'No changes';
    revertBtn.hidden = !(saved && isDirty);
    nameInput.classList.toggle('bad', !draft.name.trim());
    errorsEl.replaceChildren(...errs.map((e) => h('li', null, e)));

    previewTags.replaceChildren(...[
      h('span.g-size.big', null, s ? designSizeLabel(s) : '?'),
      s && s.squad > 1 ? h('span.g-tag.squad', { title: 'One purchase deploys a block of 4 units with adjustable spacing' }, `Squad of ${s.squad}`) : null,
      s ? h('span.g-footprint', { title: 'Physical footprint' }, footprintLabel(s.size)) : null,
      s?.flying ? h('span.g-tag.air', null, icon('air'), 'Flying') : null,
      s?.isStatic ? h('span.g-tag.static', null, icon('static'), 'Static') : null,
      isDirty ? h('span.g-tag.warn', null, selectedId ? 'Modified' : 'Unsaved') : null,
    ].filter((x): x is HTMLSpanElement => !!x));
    previewCost.replaceChildren(icon('cost'), h('b', null, s ? String(s.cost) : '–'), h('span', null, s && s.squad > 1 ? `supply / block · ${s.unitCost} per unit` : 'supply'));

    if (!s) { statsEl.replaceChildren(); loadEl.replaceChildren(); costEl.replaceChildren(); return; }
    renderCost(s, ss);
    const mdl = (k: keyof UnitStats) => (ss ? ((s[k] as number) - (ss[k] as number)) * METERS_PER_CELL : null);
    const dl = (k: keyof UnitStats) => (ss ? (s[k] as number) - (ss[k] as number) : null);
    const traits = [...new Set(s.traits)];
    statsEl.replaceChildren(
      statTile('HP', String(s.hp), dl('hp')),
      statTile('Armor', String(s.armor), dl('armor')),
      statTile('Shield', String(s.shield), dl('shield'), { cls: s.shield ? '' : 'nil' }),
      statTile('Speed', s.isStatic ? '—' : String(Math.round(s.speed * METERS_PER_CELL)), mdl('speed'), { unit: s.isStatic ? '' : 'm/s' }),
      statTile('Turn', s.isStatic ? '—' : String(deg(s.turn)), s.isStatic || !ss ? null : deg(s.turn) - deg(ss.turn), { unit: s.isStatic ? '' : '°/s' }),
      statTile('Range', s.range ? fmtMeters(s.range) : '—', mdl('range'), { }),
      statTile('DPS', String(s.dps), dl('dps'), { cls: 'hl' }),
      s.heal ? statTile('Repair', String(s.heal), dl('heal'), { unit: 'hp/s' }) : statTile('Size', sizeLabel(s.size), null, { unit: footprintLabel(s.size) }),
      statTile('Cost', String(s.cost), dl('cost'), { invert: true }),
      h('div.g-traits', null, ...traits.map((t) => h('span.g-trait', null, TRAIT_LABEL[t] ?? t))),
    );

    const pct = s.load * 100;
    const zone = s.load > MAX_LOAD ? 'red' : s.load > 1 ? 'amber' : 'green';
    const f = loadSpeedFactor(s.load);
    const spd = Math.round((f - 1) * 100);
    const mob = MOBILITY_BY_ID.get(draft.mobility);
    const speedNote = s.isStatic ? 'Immobile emplacement'
      : s.load > MAX_LOAD ? 'Overloaded — illegal'
      : spd >= 0 ? `+${spd}% speed (light load)` : `${spd}% speed (heavy load)`;
    loadEl.className = `g-load ${zone}`;
    loadEl.style.setProperty('--z1', `${(100 / BAR_MAX).toFixed(2)}%`);
    loadEl.style.setProperty('--z2', `${(MAX_LOAD * 100 / BAR_MAX).toFixed(2)}%`);
    loadEl.replaceChildren(
      h('div.g-load-h', null,
        h('span', null, icon('weight'), 'Weight'),
        h('span.g-load-num', null, h('b', null, fmt(s.weight)), ` / ${s.capacity}`, h('em', null, ` ${Math.round(pct)}%`)),
      ),
      h('div.g-bar', {
        role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': String(Math.round(MAX_LOAD * 100)), 'aria-valuenow': String(Math.round(pct)),
        'aria-label': `Load ${Math.round(pct)} percent`,
      },
      h('div.g-bar-fill', { style: { width: `${Math.min(100, (s.load / BAR_MAX) * 100).toFixed(2)}%` } }),
      h('span.g-bar-mark.m1'), h('span.g-bar-mark.m2'),
      ),
      h('div.g-load-f', null,
        h('span.g-speednote', { class: spd < 0 || s.load > MAX_LOAD ? 'neg' : 'pos' }, speedNote),
        h('span', null, `${mob?.name ?? ''} capacity ${s.capacity}`),
      ),
    );
  }

  function renderCost(s: UnitStats, ss: UnitStats | null) {
    const parts = PARTS_WEIGHT * s.partsCost;
    const pow = POWER_K * s.power;
    const tot = parts + pow || 1;
    const d = (k: 'offense' | 'ehp' | 'partsCost' | 'power') => {
      if (!ss) return null;
      const v = s[k] - ss[k];
      return Math.abs(v) < 0.5 ? null : h('span.g-delta', { class: v > 0 ? 'up' : 'down' }, `${v > 0 ? '+' : ''}${Math.round(v)}`);
    };
    const tip = 'Cost scales with predicted deadliness, so equal-supply armies are balanced.\n' +
      `Cost = ${PARTS_WEIGHT} × parts + ${POWER_K} × power, rounded up to 5.\n` +
      'Power = √(offense × effective hp) × mobility.';
    costEl.replaceChildren(
      h('div.g-cost-h', { title: tip },
        h('span', null, icon('cost'), 'Cost breakdown', h('span.g-info', { tabindex: '0', 'aria-label': tip }, 'i')),
        h('span.g-cost-total', null, h('b', null, String(s.cost)), s.squad > 1 ? ` supply / block of ${s.squad}` : ' supply'),
      ),
      h('div.g-cost-bar', { 'aria-hidden': 'true' },
        h('span.parts', { style: { width: `${(parts / tot) * 100}%` } }),
        h('span.power', { style: { width: `${(pow / tot) * 100}%` } }),
      ),
      h('div.g-cost-rows', null,
        s.squad > 1 ? h('div.g-cost-row.sub', { title: 'Each of the 4 squad units is worth this much; the block price is 4 units, rounded' },
          h('span.g-cost-k', null, 'Per unit value'), h('span', null, String(s.unitCost)), h('em', null, `×${s.squad}`)) : null,
        h('div.g-cost-row.parts', { title: 'Sum of base part costs: complexity of fielding this design' },
          h('span.g-cost-k', null, h('i'), 'Parts complexity'), h('span', null, String(Math.round(s.partsCost)), d('partsCost')), h('em', null, `≈${Math.round(parts)}`)),
        h('div.g-cost-row.power', { title: 'Predicted combat power: √(offense × effective hp) × mobility' },
          h('span.g-cost-k', null, h('i'), 'Combat power'), h('span', null, String(s.power), d('power')), h('em', null, `≈${Math.round(pow)}`)),
        h('div.g-cost-row.sub', { title: 'Damage output rated vs a mix of armor, incl. splash, chain, stun, burn, range' },
          h('span.g-cost-k', null, 'Offense rating'), h('span', null, String(s.offense), d('offense')), h('em')),
        h('div.g-cost-row.sub', { title: 'HP + shield, scaled by armor, evasion and flight' },
          h('span.g-cost-k', null, 'Effective HP'), h('span', null, String(s.ehp), d('ehp')), h('em')),
      ),
    );
  }

  function renderChassis() {
    chassisEl.replaceChildren(...CHASSIS.map((c) => {
      const sel = c.id === draft.chassis;
      return h('button.g-card.g-ccard', {
        type: 'button', class: sel ? 'sel' : null, 'aria-pressed': String(sel), 'data-fk': `ch-${c.id}`,
        title: c.desc, onclick: () => pickChassis(c.id),
      },
      h('span.g-card-top', null, partIcon('chassis', c.id, 48), h('span.g-card-name', null, c.name), h('span.g-size', null, sizeLabel(c.size))),
      h('span.g-card-stats', null,
        h('span', null, h('b', null, String(c.hp)), ' hp'),
        h('span', null, h('b', null, String(c.armor)), ' arm'),
        h('span', null, h('b', null, String(c.weight)), ' wt'),
        h('span.g-agil', { title: `Agility ×${c.agility.toFixed(2)}: multiplies body turn rate` },
          'Agility ', h('b', null, `×${c.agility.toFixed(2)}`),
          h('span.g-acc-track', null, h('span.g-acc-fill', { style: { width: `${Math.min(100, (c.agility / 1.5) * 100).toFixed(0)}%` } }))),
      ),
      h('span.g-card-bot', null,
        h('span.g-chips', null, ...c.mounts.map((m) => h('span.g-chip', { class: `c${m}` }, m))),
        h('span.g-card-cost', null, icon('cost'), String(c.cost)),
      ),
      h('span.g-card-desc', null, c.desc),
      );
    }));
  }

  function renderMobility() {
    const c = CHASSIS_BY_ID.get(draft.chassis)!;
    mobilityEl.replaceChildren(...MOBILITY.map((m) => {
      const err = pairingError(draft.chassis, m.id);
      const sel = m.id === draft.mobility;
      const res = err ? null : statsOf({ ...draft, mobility: m.id });
      const loadCls = res ? (res.load > MAX_LOAD ? 'red' : res.load > 1 ? 'amber' : 'green') : '';
      return h('button.g-card.g-mcard', {
        type: 'button', class: [sel ? 'sel' : '', err ? 'dis' : ''].join(' '), 'aria-pressed': String(sel),
        'aria-disabled': err ? 'true' : null, 'data-fk': `mob-${m.id}`,
        title: err ?? m.desc, onclick: () => pickMobility(m.id),
      },
      h('span.g-card-top', null,
        partIcon('mobility', m.id, 48),
        h('span.g-card-name', null, icon(m.kind === 'air' ? 'air' : m.kind === 'static' ? 'static' : 'ground', `k-${m.kind}`), m.name),
        h('span.g-kind', null, KIND_LABEL[m.kind]),
      ),
      err
        ? h('span.g-card-err', null, err)
        : h('span.g-card-stats', null,
          h('span', null, h('b', null, m.kind === 'static' ? '0' : String(Math.round(res!.speed * METERS_PER_CELL))), ' m/s'),
          m.kind === 'static' ? null : h('span', { title: 'Base turn rate before chassis agility, size and load' }, h('b', null, String(deg(m.turn))), '°/s turn'),
          h('span', null, h('b', null, String(m.capacity[c.size - 1])), ' cap'),
          h('span.g-loadpct', { class: loadCls }, h('b', null, `${Math.round(res!.load * 100)}%`), ' load'),
          h('span.g-card-cost', null, icon('cost'), String(m.cost * c.size)),
        ),
      h('span.g-card-desc', null, [m.desc, ...m.traits.map((t) => TRAIT_LABEL[t] ?? t)].join(' · ')),
      );
    }));
  }

  function renderMounts() {
    const c = CHASSIS_BY_ID.get(draft.chassis)!;
    const s = statsOf(draft);
    mountsEl.replaceChildren(...c.mounts.map((cls, i) => {
      const cur = draft.mounts[i] ? MODULE_BY_ID.get(draft.mounts[i]!) : undefined;
      const open = openSlot === i;
      const head = h('button.g-slot-head', {
        type: 'button', 'aria-expanded': String(open), 'data-fk': `slot-${i}`,
        title: cur ? moduleTooltip(cur) : `Empty ${cls} slot`,
        onclick: () => { openSlot = open ? null : i; pickerCat = cur?.category ?? null; sfx('click'); update(); },
      },
      h('span.g-chip.big', { class: `c${cls}` }, cls),
      cur ? partIcon('module', cur.id, 40, true) : h('span.g-particon.blank', { style: { width: '40px', height: '40px' } }),
      cur
        ? h('span.g-slot-cur', null,
          h('span.g-slot-name', null, cur.name, h('span.g-fam', null, cur.family), cur.mount !== cls ? h('span.g-chip', { class: `c${cur.mount}` }, cur.mount) : null),
          moduleStats(cur, true))
        : h('span.g-slot-cur.empty', null, h('span.g-slot-name', null, 'Empty slot'), h('span.g-modstats', null, 'Choose a module')),
      h('span.g-slot-chev', null, icon('chevron')),
      );
      const row = h('div.g-slot', { class: [open ? 'open' : '', cur ? `k-${cur.kind}` : 'empty'].join(' ') }, head);
      if (open) {
        const curW = cur?.weight ?? 0;
        const opt = (id: string | null) => {
          const mod = id ? MODULE_BY_ID.get(id)! : null;
          const w = (s?.weight ?? 0) - curW + (mod?.weight ?? 0);
          const load = s ? w / s.capacity : 0;
          const warn = load > MAX_LOAD ? 'over' : load > 1 ? 'heavy' : '';
          const sel = (draft.mounts[i] ?? null) === id;
          const lock = mod ? reqReason(mod) : null;
          return h('button.g-opt', {
            type: 'button', class: [sel ? 'sel' : '', warn, mod ? `k-${mod.kind}` : 'k-empty', lock ? 'locked' : ''].join(' '),
            disabled: !!lock && !sel,
            'aria-pressed': String(sel), 'data-fk': `opt-${i}-${id ?? 'none'}`,
            title: lock ? `${lock} — ${moduleTooltip(mod!)}` : mod ? moduleTooltip(mod) : 'Leave this slot empty',
            style: mod ? { '--cat': moduleCategoryColor(mod.id) } : null,
            onclick: () => pickModule(i, id),
          },
          h('span.g-opt-ico', null, mod ? partIcon('module', mod.id, 38, true) : icon('x')),
          h('span.g-opt-name', null, mod ? mod.name : 'Empty slot',
            mod ? h('span.g-fam', null, mod.family) : null,
            mod ? h('span.g-chip', { class: `c${mod.mount}` }, mod.mount) : null,
            mod?.requires === 'air' ? h('span.g-tag.aironly', null, 'AIR ONLY MOUNT') : null,
            mod?.requires === 'ground' ? h('span.g-tag.aironly', null, 'GROUND ONLY MOUNT') : null),
          mod ? moduleStats(mod, true) : h('span.g-modstats', null, 'Leave this mount empty'),
          lock ? h('span.g-opt-lock', null, lock) : null,
          h('span.g-opt-side', null,
            h('span', { title: 'Weight' }, icon('weight'), mod ? String(mod.weight) : '0'),
            h('span', { title: 'Base part cost (unit cost also scales with combat power)' }, icon('cost'), mod ? String(mod.cost) : '0'),
            warn ? h('span.g-opt-warn', null, warn === 'over' ? 'overload' : 'slows') : null,
          ),
          );
        };
        const fits = MODULES.filter((m) => fitsMount(cls, m.mount));
        const cats = CATEGORIES.filter((k) => fits.some((m) => m.category === k.id));
        if (!pickerCat || !cats.some((k) => k.id === pickerCat)) pickerCat = cur?.category ?? cats[0]?.id ?? null;
        const catDef = cats.find((k) => k.id === pickerCat);
        const tabs = h('div.g-tabs', { role: 'tablist', 'aria-label': 'Module category' }, ...cats.map((k) => {
          const on = k.id === pickerCat;
          const n = fits.filter((m) => m.category === k.id).length;
          const hasCur = cur?.category === k.id;
          return h('button.g-tab', {
            type: 'button', role: 'tab', 'aria-selected': String(on), class: [on ? 'on' : '', hasCur ? 'has' : ''].join(' '),
            'data-fk': `tab-${i}-${k.id}`, title: k.desc,
            onclick: () => { pickerCat = k.id; sfx('click'); update(); },
          }, h('i.g-catdot', { style: { background: CATEGORY_COLOR[k.id] ?? '#b0b8c0' } }), k.name, h('small', null, String(n)));
        }));
        const list = fits.filter((m) => m.category === pickerCat)
          .sort((x, y) => RANK[x.mount] - RANK[y.mount] || x.cost - y.cost);
        row.append(h('div.g-opts', null,
          tabs,
          catDef ? h('p.g-catdesc', null, catDef.desc) : null,
          h('div.g-optlist', { role: 'group', 'aria-label': `${catDef?.name ?? ''} modules for slot ${i + 1}` }, ...list.map((m) => opt(m.id))),
          opt(null),
        ));
      }
      return row;
    }));
  }

  // ---------------- animation ----------------
  function fit(c: HTMLCanvasElement): boolean {
    const r = c.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight) return false;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(r.width * dpr), hh = Math.round(r.height * dpr);
    if (c.width !== w || c.height !== hh) { c.width = w; c.height = hh; }
    return true;
  }
  let frame = 0;
  let raf = 0;
  const tick = (now: number) => {
    if (destroyed) return;
    const t = now / 1000;
    const dt = lastT ? Math.min(0.1, t - lastT) : 0;
    lastT = t;
    if (spin && !drag) angle += dt * 0.5;
    try {
      if (fit(preview)) drawUnitPreview(preview, draft, { side: 0, time: t, angle });
      if (frame++ % 2 === 0) {
        for (const { c, get } of listCanvases) if (fit(c)) drawUnitPreview(c, get(), { side: 0, time: t, angle: -Math.PI / 2 });
      }
    } catch (err) {
      // a renderer hiccup must never kill the garage
      if (frame < 3) console.warn('preview render failed', err);
    }
    raf = requestAnimationFrame(tick);
  };

  const onKey = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (dirty()) doSave();
    } else if (e.key === 'Escape' && openSlot !== null) {
      const i = openSlot;
      openSlot = null;
      update();
      (el.querySelector(`[data-fk="slot-${i}"]`) as HTMLElement | null)?.focus();
    }
  };
  const onUnload = (e: BeforeUnloadEvent) => { if (dirty()) e.preventDefault(); };
  document.addEventListener('keydown', onKey);
  window.addEventListener('beforeunload', onUnload);

  nameInput.value = draft.name;
  syncSpin();
  update();
  raf = requestAnimationFrame(tick);

  return {
    el,
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onUnload);
    },
  };
};
