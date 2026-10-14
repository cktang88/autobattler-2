// Garage (hangar): design units from chassis + mobility + mount modules, manage the collection and deck.
//
// Layout: roster | blueprint bench (unit on a true-scale 5 m grid, mount sockets on the hull) | parts bay (tabs + inspector).
// Modules are dragged from the bay onto the sockets drawn on the robot (or the loadout strip under it); dragging a mounted
// module onto another socket swaps them, dragging it off the robot removes it.

import { h } from '../app.ts';
import type { ScreenFn } from '../app.ts';
import { sfx } from '../audio.ts';
import { kiteOptions, ordersControl, ordersOf, orderFields, ringsOf } from './match-ui.ts';
import { activeDeck, allDesigns, deleteDesign, newDesignId, saveDesign, setDeck } from '../collection.ts';
import { drawUnitPreview, type PreviewGeom } from '../render/field.ts';
import { METERS_PER_CELL, fmtMeters } from '../../shared/grid.ts';
import { randomDesignName } from '../../shared/names.ts';
import { DECK_SIZE } from '../../shared/match.ts';
import { slotError } from '../../shared/stats.ts';
import { meleeSlots } from '../../shared/mountgeo.ts';
import { CATEGORIES, CHASSIS, CHASSIS_BY_ID, DOMAINS, chassisDomain, mobilityDomain, MOBILITY, MOBILITY_BY_ID, MODULES, MODULE_BY_ID, ROLES, fitsMount, pairingError, MOUNT_RANK, MOUNT_LETTER, MOUNT_NAME, moduleRoles } from '../../shared/parts.ts';
import * as kit from './kit.ts';
import { MAX_LOAD, PARTS_WEIGHT, POWER_K, accuracyRating, computeStats, defaultOrders, loadSpeedFactor, validateDesign, weaponDps } from '../../shared/stats.ts';
import type { ChassisDef, Design, Domain, MobilityDef, ModuleDef, MountClass, UnitStats } from '../../shared/types.ts';
import {
  KIND_LABEL, TRAIT_LABEL, accuracyLabel, firingText, fmt, icon, modal, moduleCategoryColor, moduleEffects, partIcon, sizeLabel,
  designSizeLabel, footprintLabel, CATEGORY_COLOR, roleTags, traverseDeg, SLOW_TURRET_DEG, SIZE_CLASSES,
} from './garage-parts.ts';

const RANK: Record<MountClass, number> = MOUNT_RANK;
const ML = MOUNT_LETTER;
const sizeTip = (c: MountClass) => `Size ${ML[c]} (${MOUNT_NAME[c].toLowerCase()}). Sockets run S, M, L (giant-class) and XL (titan-class) and take parts of their size or smaller.`;
const NAME_MAX = 24;
/** Weight bar spans 0..BAR_MAX load. */
const BAR_MAX = 1.8;
/** The bench never zooms in tighter than this many cells, so a 5 m scout looks small next to a 25 m titan. */
const MIN_VIEW_CELLS = 3.4;

type Tab = 'hull' | 'drive' | 'weapons' | 'systems' | 'orders' | 'intel';
const TABS: { id: Tab; label: string; key: string; tip: string }[] = [
  { id: 'hull', label: 'Hull', key: 'Q', tip: 'Chassis: size, armor and mount sockets' },
  { id: 'drive', label: 'Drive', key: 'W', tip: 'Mobility: speed, turning and weight capacity' },
  { id: 'weapons', label: 'Weapons', key: 'E', tip: 'Guns, launchers and melee — drag onto a socket' },
  { id: 'systems', label: 'Systems', key: 'R', tip: 'Shields, support, stealth, upgrades and armor plating' },
  { id: 'orders', label: 'Orders', key: 'T', tip: 'Default battle AI for this design' },
  { id: 'intel', label: 'Intel', key: 'Y', tip: 'Full stats and cost breakdown' },
];
const TAB_ICON: Record<Tab, string> = {
  hull: '<path d="M4 9l8-5 8 5v6l-8 5-8-5z"/><path d="M4 9l8 5 8-5M12 14v6"/>',
  drive: '<circle cx="7" cy="17" r="3"/><circle cx="17" cy="17" r="3"/><path d="M4 12h16M7 12l2-5h6l2 5"/>',
  weapons: '<circle cx="12" cy="12" r="6.5"/><path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5"/>',
  systems: '<path d="M12 3l8 3v6c0 4.8-3.4 8-8 9-4.6-1-8-4.2-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  orders: '<path d="M5 4v16M5 5h11l-2 4 2 4H5"/>',
  intel: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
};
/** Sub-tabs: weapons and systems are split into a handful of single-choice groups, each listing its categories as sections. */
type Group = { id: string; label: string; tip: string; cats: string[] };
const WEAPON_GROUPS: Group[] = [
  { id: 'ballistic', label: 'Guns', tip: 'Machine guns, autocannons and tank cannons', cats: ['machinegun', 'autocannon', 'cannon'] },
  { id: 'rockets', label: 'Rockets', tip: 'Rocket salvos and homing missiles', cats: ['rocket', 'missile'] },
  { id: 'longrange', label: 'Long range', tip: 'Snipers, railguns and artillery', cats: ['precision', 'artillery'] },
  { id: 'energy', label: 'Energy', tip: 'Beams, plasma, lightning and stun weapons', cats: ['energy', 'disruption'] },
  { id: 'close', label: 'Close', tip: 'Flamers and melee', cats: ['flame', 'melee'] },
  { id: 'aa', label: 'Anti-air', tip: 'Dedicated flak', cats: ['antiair'] },
];
const SYSTEM_GROUPS: Group[] = [
  { id: 'defense', label: 'Defense', tip: 'Shields, point defense, smoke and coatings', cats: ['defense'] },
  { id: 'armor', label: 'Armor', tip: 'Plating: more hp and armor for weight', cats: ['armor'] },
  { id: 'support', label: 'Support', tip: 'Repair beams, shield domes and uplinks', cats: ['support'] },
  { id: 'electronics', label: 'Electronics', tip: 'Cloaks, jammers, sensors and system upgrades', cats: ['stealth', 'systems'] },
];
const WEAPON_CAT_SET = new Set(WEAPON_GROUPS.flatMap((g) => g.cats));
const isWeaponTab = (m: ModuleDef) => WEAPON_CAT_SET.has(m.category);
const LS_DETAILS = 'garage.details';

const LS_TAB = 'garage.tab';
const loadTab = (): Tab => {
  try { const t = localStorage.getItem(LS_TAB); if (t && TABS.some((x) => x.id === t)) return t as Tab; } catch { /* storage unavailable */ }
  return 'weapons';
};
const saveTab = (t: Tab) => { try { localStorage.setItem(LS_TAB, t); } catch { /* ignore */ } };

const clone = (d: Design): Design => ({ id: d.id, name: d.name, chassis: d.chassis, mobility: d.mobility, mounts: [...d.mounts], ...(d.behavior ? { behavior: { ...d.behavior } } : {}) });
const same = (a: Design, b: Design) =>
  a.name === b.name && a.chassis === b.chassis && a.mobility === b.mobility &&
  JSON.stringify(a.behavior ?? {}) === JSON.stringify(b.behavior ?? {}) &&
  a.mounts.length === b.mounts.length && a.mounts.every((m, i) => (m ?? null) === (b.mounts[i] ?? null));

function statsOf(d: Design): UnitStats | null {
  try { return computeStats(d); } catch { return null; }
}

/** Chassis footprint as "w × l" (square: one edge, or "a × a" when `full`). */
const footDims = (c: ChassisDef, full = false) => {
  const w = c.footprint?.[0] ?? c.size, l = c.footprint?.[1] ?? c.size;
  return w === l && !full ? footprintLabel(w) : `${footprintLabel(w)} × ${footprintLabel(l)}`;
};
const firstLegalMobility =(chassisId: string) => MOBILITY.find((m) => !pairingError(chassisId, m.id))?.id ?? MOBILITY[0].id;

/** Re-seat modules onto a new chassis: biggest modules first, each into the smallest free slot that fits. */
function reseat(mods: (string | null)[], c: ChassisDef, mobility: string): (string | null)[] {
  const out: (string | null)[] = c.mounts.map(() => null);
  const list = mods.filter((m): m is string => !!m && MODULE_BY_ID.has(m))
    .sort((a, b) => RANK[MODULE_BY_ID.get(b)!.mount] - RANK[MODULE_BY_ID.get(a)!.mount]);
  const slots = c.mounts.map((cls, i) => ({ cls, i })).sort((a, b) => RANK[a.cls] - RANK[b.cls]);
  for (const id of list) {
    const mod = MODULE_BY_ID.get(id)!;
    const s = slots.find((s) => out[s.i] === null && !slotError(c, mobility, s.i, mod));
    if (s) out[s.i] = id;
  }
  return out;
}

/** Class badge shown on roster rows. */
const DOMAIN_BADGE: Record<Domain, string> = { ground: 'GND', jet: 'JET', heli: 'HELI' };
/** Representative hull drawn on each class card, and the default hull of a new design in that class. */
const DOMAIN_ICON: Record<Domain, string> = { ground: 'raider', jet: 'strikejet', heli: 'gunship' };
const DOMAIN_SHORT: Record<Domain, string> = { ground: 'Ground', jet: 'Jet aircraft', heli: 'Helicopter · VTOL' };
const domainChassis = (dom: Domain) => CHASSIS.filter((c) => chassisDomain(c) === dom);
const domainMobility = (dom: Domain) => MOBILITY.filter((m) => mobilityDomain(m) === dom);
const designDomain = (d: Design): Domain => { const c = CHASSIS_BY_ID.get(d.chassis); return c ? chassisDomain(c) : 'ground'; };

function blankDesign(taken: string[], dom: Domain = 'ground'): Design {
  const c = CHASSIS_BY_ID.get(DOMAIN_ICON[dom]) ?? domainChassis(dom)[0] ?? CHASSIS[0];
  const mobility = firstLegalMobility(c.id);
  const flies = MOBILITY_BY_ID.get(mobility)?.kind === 'air';
  const weapon = MODULES.find((m) => m.kind === 'weapon' && fitsMount(c.mounts[0], m.mount) && !(m.requires === 'ground' && flies) && !(m.requires === 'air' && !flies))!;
  return {
    id: newDesignId(), name: randomDesignName(c.id, Math.random, taken), chassis: c.id, mobility,
    mounts: c.mounts.map((_, i) => (i === 0 ? weapon.id : null)),
  };
}

function svgIcon(paths: string): HTMLSpanElement {
  const s = h('span.g-ico', { 'aria-hidden': 'true' });
  s.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  return s;
}

type Inspect = { kind: 'chassis' | 'mobility' | 'module'; id: string };
/** Where a drag started: the parts bay, or a mounted socket. */
type DragSrc = { mod: string; from: number | null };

export const garageScreen: ScreenFn<{ name: 'garage' }> = (app) => {
  // ---------------- state ----------------
  let designs = allDesigns();
  let deck = activeDeck().map((d) => d.id);
  let selectedId: string | null = designs[0]?.id ?? null;
  let saved: Design | null = designs[0] ? clone(designs[0]) : null;
  let draft: Design = saved ? clone(saved) : blankDesign(designs.map((d) => d.name));
  /** true while the name is an auto-generated one the player has not typed over */
  let autoName = !saved;
  let tab: Tab = loadTab();
  /** socket the player is fitting (null = none picked; equips go to the best free socket) */
  let activeSlot: number | null = null;
  /** pinned inspector subject per tab; hover temporarily overrides it */
  const pinned: Partial<Record<Tab, Inspect>> = {};
  let hoverInspect: Inspect | null = null;
  const groupSel: Record<'weapons' | 'systems', string> = { weapons: WEAPON_GROUPS[0].id, systems: SYSTEM_GROUPS[0].id };
  let roleSel = '*';
  let sizeSel = 0;
  let driveSel = '*';
  const openMore = new Set<string>();
  let showDetails = (() => { try { return localStorage.getItem(LS_DETAILS) === '1'; } catch { return false; } })();
  let modQuery = '';
  /** range overlay: zooms the bench out to fit every weapon's reach */
  let rangesOn = false;
  let viewExt = MIN_VIEW_CELLS;
  /** blueprint zoom (1 = fit) and pan offset of the view centre (cells); wheel / buttons / drag empty space */
  let zoom = 1, zoomT = 1;
  const pan = { x: 0, y: 0 };
  const ZOOM_MIN = 0.5, ZOOM_MAX = 5;
  let destroyed = false;
  let geom: PreviewGeom | null = null;

  const dirty = () => !saved || !same(saved, draft);
  const chassis = () => CHASSIS_BY_ID.get(draft.chassis)!;

  // ---------------- static skeleton ----------------
  const deckChip = h('span.g-deckchip', { role: 'status', 'aria-live': 'polite' });
  const listEl = h('div.g-items', { role: 'list' });
  const gridCv = h('canvas.g-grid', { 'aria-hidden': 'true' });
  const preview = h('canvas.g-preview', { 'aria-label': 'Unit blueprint', role: 'img' });
  const socketsEl = h('div.g-sockets');
  const stageTags = h('div.g-prev-tags');
  const stageCost = h('div.g-prev-cost');
  const stageHint = h('div.g-stage-hint');
  const nameInput = h('input.g-name', { type: 'text', maxlength: NAME_MAX, 'aria-label': 'Design name', spellcheck: 'false', autocomplete: 'off' });
  const rerollBtn = h('button.g-iconbtn', { type: 'button', title: 'Random name', 'aria-label': 'Pick a random name', onclick: () => reroll() }, svgIcon('<rect x="4" y="4" width="16" height="16" rx="2"/><circle cx="9" cy="9" r="1.2" fill="currentColor"/><circle cx="15" cy="15" r="1.2" fill="currentColor"/><circle cx="15" cy="9" r="1.2" fill="currentColor"/><circle cx="9" cy="15" r="1.2" fill="currentColor"/>'));
  const saveBtn = h('button.g-btn.primary', { type: 'button', onclick: () => doSave() }, icon('save'), 'Save');
  const revertBtn = h('button.g-btn', { type: 'button', title: 'Revert to saved', onclick: () => revert() }, icon('undo'), 'Revert');
  const errorsEl = h('ul.g-errors', { 'aria-live': 'polite' });
  const loadoutEl = h('div.g-loadout', { role: 'list', 'aria-label': 'Mount sockets' });
  const readoutEl = h('div.g-readout');
  const loadEl = h('div.g-load');
  const tabsEl = h('nav.g-tabs', { role: 'tablist', 'aria-label': 'Parts' });
  const bayBody = h('div.g-baybody', { role: 'tabpanel' });
  const inspector = h('div.g-inspector', { 'aria-live': 'polite' });
  const listCanvases: { c: HTMLCanvasElement; get: () => Design }[] = [];

  nameInput.addEventListener('input', () => {
    draft.name = nameInput.value.slice(0, NAME_MAX);
    autoName = false;
    update();
  });

  const rangeBtn = h('button.g-stagebtn', {
    type: 'button', title: 'Show weapon ranges (V)', 'aria-pressed': 'false',
    onclick: () => toggleRanges(),
  }, svgIcon('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>'), 'Ranges');
  const classEl = h('div.g-classes', { role: 'radiogroup', 'aria-label': 'Unit class' });
  const zoomLbl = h('span.g-zoomlbl', { 'aria-live': 'polite' }, '1×');
  const zbtn = (label: string, title: string, fn: () => void) => h('button.g-zoombtn', { type: 'button', title, 'aria-label': title, onclick: fn }, label);
  const zoomCtl = h('div.g-zoom', { role: 'group', 'aria-label': 'Blueprint zoom' },
    zbtn('−', 'Zoom out (-)', () => setZoom(zoomT / 1.4)),
    zbtn('Fit', 'Fit the unit (0 / double-click)', () => resetView()),
    zbtn('+', 'Zoom in (+)', () => setZoom(zoomT * 1.4)),
    zoomLbl);
  const stage = h('div.g-stage', null,
    gridCv, preview, socketsEl,
    h('div.g-stage-hud', null, stageTags, h('span.spacer'), zoomCtl, rangeBtn),
    stageCost,
    stageHint,
  );

  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    setZoom(zoomT * Math.exp(-e.deltaY * 0.0015), { x: e.clientX - r.left, y: e.clientY - r.top });
  }, { passive: false });
  // drag empty blueprint to pan (sockets and buttons keep their own handling)
  let panDrag: { x: number; y: number; px: number; py: number; id: number } | null = null;
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button, .g-sock')) return;
    panDrag = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y, id: e.pointerId };
    stage.setPointerCapture(e.pointerId);
    stage.classList.add('panning');
  });
  stage.addEventListener('pointermove', (e) => {
    if (!panDrag || e.pointerId !== panDrag.id || !geom) return;
    pan.x = panDrag.px - (e.clientX - panDrag.x) / geom.px;
    pan.y = panDrag.py - (e.clientY - panDrag.y) / geom.px;
  });
  const endPan = () => { panDrag = null; stage.classList.remove('panning'); };
  stage.addEventListener('pointerup', endPan);
  stage.addEventListener('pointercancel', endPan);
  stage.addEventListener('dblclick', (e) => { if (!(e.target as HTMLElement).closest('button, .g-sock')) resetView(); });

  const el = h('div.garage', null,
    h('header.g-top', null,
      h('button.g-btn.g-back', { type: 'button', onclick: () => leave() }, icon('back'), 'Menu'),
      h('h1.g-title', null, h('span.g-title-k', null, 'Hangar'), h('span.g-title-s', null, 'Design bureau')),
      h('span.g-hazard', { 'aria-hidden': 'true' }),
      deckChip,
    ),
    h('div.g-body', null,
      h('aside.g-list', { 'aria-label': 'Your designs' },
        h('div.g-plate-h', null,
          h('h2', null, 'Roster'),
          h('div.g-list-btns', null,
            h('button.g-iconbtn', { type: 'button', title: 'New design', 'aria-label': 'New design', onclick: () => newDesign() }, icon('plus')),
            h('button.g-iconbtn', { type: 'button', title: 'Duplicate', 'aria-label': 'Duplicate design', onclick: () => duplicate() }, icon('copy')),
            h('button.g-iconbtn.danger', { type: 'button', title: 'Delete', 'aria-label': 'Delete design', onclick: () => remove() }, icon('trash')),
          ),
        ),
        listEl,
      ),
      h('section.g-bench', { 'aria-label': 'Blueprint' },
        h('div.g-namebar', null, nameInput, rerollBtn, revertBtn, saveBtn),
        classEl,
        stage,
        loadoutEl,
        errorsEl,
        readoutEl,
        loadEl,
      ),
      h('section.g-bay', { 'aria-label': 'Parts bay' },
        tabsEl,
        bayBody,
        inspector,
      ),
    ),
  );

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

  function load(d: Design | null, dom: Domain = 'ground') {
    selectedId = d?.id ?? null;
    saved = d ? clone(d) : null;
    draft = d ? clone(d) : blankDesign(designs.map((x) => x.name), dom);
    autoName = !d;
    activeSlot = null;
    pan.x = pan.y = 0; // new design: recentre (zoom level is kept)
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
    load(null, designDomain(draft));
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
    load(null, designDomain(src));
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
    activeSlot = null;
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
    activeSlot = null;
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

  function reroll() {
    draft.name = randomDesignName(draft.chassis, Math.random, designs.filter((d) => d.id !== draft.id).map((d) => d.name)).slice(0, NAME_MAX);
    autoName = true;
    nameInput.value = draft.name;
    sfx('click');
    update();
  }

  function pickChassis(id: string) {
    pinned.hull = { kind: 'chassis', id };
    if (id === draft.chassis) { update(); return; }
    const c = CHASSIS_BY_ID.get(id)!;
    const mobility = pairingError(id, draft.mobility) ? firstLegalMobility(id) : draft.mobility;
    const before = draft.mounts.filter(Boolean).length;
    draft = { ...draft, chassis: id, mobility, mounts: reseat(draft.mounts, c, mobility) };
    const lost = before - draft.mounts.filter(Boolean).length;
    if (autoName) { draft.name = randomDesignName(id, Math.random, designs.filter((d) => d.id !== draft.id).map((d) => d.name)).slice(0, NAME_MAX); nameInput.value = draft.name; }
    activeSlot = null;
    if (lost > 0) app.toast(`${lost} module${lost > 1 ? 's' : ''} did not fit the ${c.name} and went back to stores`);
    sfx('click');
    update();
  }

  /** Switch unit class: first hull + first legal drive of that class; modules that still fit stay mounted. */
  function pickDomain(dom: Domain) {
    if (dom === designDomain(draft)) return;
    const c = domainChassis(dom).sort((a, b) => a.size - b.size || a.weight - b.weight)[0];
    if (!c) return;
    const mobility = firstLegalMobility(c.id);
    const before = draft.mounts.filter(Boolean).length;
    const usable = draft.mounts.map((id) => (id && !reqReason(MODULE_BY_ID.get(id) ?? {}, mobility) ? id : null));
    draft = { ...draft, chassis: c.id, mobility, mounts: reseat(usable, c, mobility) };
    const lost = before - draft.mounts.filter(Boolean).length;
    if (autoName) { draft.name = randomDesignName(c.id, Math.random, designs.filter((d) => d.id !== draft.id).map((d) => d.name)).slice(0, NAME_MAX); nameInput.value = draft.name; }
    pinned.hull = { kind: 'chassis', id: c.id };
    pinned.drive = { kind: 'mobility', id: mobility };
    activeSlot = null;
    sizeSel = 0; roleSel = '*'; driveSel = '*';
    if (lost > 0) app.toast(`${lost} module${lost > 1 ? 's' : ''} did not fit the ${c.name} and went back to stores`);
    sfx('click');
    update();
  }

  function pickMobility(id: string) {
    pinned.drive = { kind: 'mobility', id };
    const err = pairingError(draft.chassis, id);
    if (err) { sfx('error'); app.toast(err, 'error'); update(); return; }
    if (id !== draft.mobility) { draft = { ...draft, mobility: id }; sfx('click'); }
    update();
  }

  /** why a module can't be mounted with the current mobility (null = fine) */
  function reqReason(mod: { requires?: 'air' | 'ground' }, mobility = draft.mobility): string | null {
    if (!mod.requires) return null;
    const flies = MOBILITY_BY_ID.get(mobility)?.kind === 'air';
    if (mod.requires === 'air' && !flies) return 'Flying designs only';
    if (mod.requires === 'ground' && flies) return 'Ground designs only';
    return null;
  }

  /** null if `mod` can go into socket `i`, else the reason it can't (shared rules: size, melee edge, air/ground) */
  function slotBlock(mod: ModuleDef, i: number): string | null {
    const cls = chassis().mounts[i];
    if (!cls) return 'No such socket';
    if (!fitsMount(cls, mod.mount)) return `Needs a size ${ML[mod.mount]} socket (this is ${ML[cls]})`;
    return slotError(chassis(), draft.mobility, i, mod);
  }

  /** why `mod` fits no socket of the current chassis + mobility (null = it fits somewhere) */
  function noFitReason(mod: ModuleDef): string | null {
    const c = chassis();
    const errs = c.mounts.map((_, i) => slotBlock(mod, i));
    if (errs.some((e) => !e)) return null;
    const sized = errs.filter((e) => e && !e.startsWith('Needs a size'));
    if (!sized.length) return `Needs a size ${ML[mod.mount]} socket or bigger — the ${c.name} has none`;
    return sized[0]!;
  }

  const isEdge = (i: number) => !!meleeSlots(chassis())[i];

  /** Best socket for a module: the active one if it fits, else the smallest empty one, else the smallest occupied one. */
  function autoSlot(mod: ModuleDef): number | null {
    if (activeSlot !== null && !slotBlock(mod, activeSlot)) return activeSlot;
    const order = chassis().mounts.map((cls, i) => ({ cls, i })).filter((s) => !slotBlock(mod, s.i)).sort((a, b) => RANK[a.cls] - RANK[b.cls]);
    return (order.find((s) => !draft.mounts[s.i]) ?? order[0])?.i ?? null;
  }

  function setMounts(mounts: (string | null)[]) {
    draft = { ...draft, mounts };
  }

  function equip(slot: number, id: string | null, quiet = false) {
    const mounts = [...draft.mounts];
    mounts[slot] = id;
    setMounts(mounts);
    activeSlot = slot;
    if (!quiet) sfx(id ? 'place' : 'click');
    update();
  }

  function quickEquip(id: string) {
    const mod = MODULE_BY_ID.get(id);
    if (!mod) return;
    const slot = autoSlot(mod);
    if (slot === null) {
      sfx('invalid');
      app.toast(noFitReason(mod) ?? `No size ${ML[mod.mount]} socket on the ${chassis().name}`, 'error');
      return;
    }
    equip(slot, id);
  }

  /** Move/swap a mounted module between sockets. */
  function moveSlot(from: number, to: number) {
    if (from === to) return;
    const a = draft.mounts[from] ?? null, b = draft.mounts[to] ?? null;
    const ma = a ? MODULE_BY_ID.get(a) : undefined, mb = b ? MODULE_BY_ID.get(b) : undefined;
    if (ma && slotBlock(ma, to)) { sfx('invalid'); app.toast(slotBlock(ma, to)!, 'error'); return; }
    const mounts = [...draft.mounts];
    mounts[to] = a;
    mounts[from] = null;
    if (mb) {
      // the displaced module swaps back if it fits, else moves to another free socket that takes it
      const home = !slotBlock(mb, from) ? from : chassis().mounts.findIndex((_, k) => k !== to && !mounts[k] && !slotBlock(mb, k));
      if (home < 0) { sfx('invalid'); app.toast(`No free socket left for ${mb.name} — unmount it first`, 'error'); return; }
      mounts[home] = b;
      if (home !== from) app.toast(`${mb.name} moved to socket ${home + 1}`);
    }
    setMounts(mounts);
    activeSlot = to;
    sfx('place');
    update();
  }

  function setTab(t: Tab, focus = false) {
    if (t === tab) return;
    tab = t;
    hoverInspect = null;
    saveTab(t);
    sfx('click');
    update();
    bayBody.scrollTop = 0;
    if (focus) (el.querySelector(`[data-fk="tab-${t}"]`) as HTMLElement | null)?.focus();
  }

  function setZoom(z: number, about?: { x: number; y: number }) {
    const nz = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
    // keep the point under the cursor fixed while zooming
    if (about && geom) {
      const wx = (about.x - geom.cx) / geom.px, wy = (about.y - geom.cy) / geom.px;
      const f = 1 - zoomT / nz;
      pan.x += wx * f; pan.y += wy * f;
    }
    zoomT = nz;
    if (zoomT <= 1.001) { pan.x = 0; pan.y = 0; }
    zoomLbl.textContent = `${Math.round(zoomT * 10) / 10}×`;
  }
  function resetView() { zoomT = 1; pan.x = pan.y = 0; zoomLbl.textContent = '1×'; }

  function toggleRanges() {
    rangesOn = !rangesOn;
    sfx('click');
    update();
  }

  /** Click on a socket: select it and open the matching bay tab. */
  function focusSlot(i: number) {
    const why = el.classList.contains('picking') ? el.querySelector<HTMLElement>(`.g-sock[data-sock="${i}"]`)?.dataset.why : '';
    if (why && !draft.mounts[i]) { sfx('invalid'); app.toast(why, 'error'); }
    if (activeSlot === i) { activeSlot = null; sfx('click'); update(); return; }
    activeSlot = i;
    const cur = draft.mounts[i] ? MODULE_BY_ID.get(draft.mounts[i]!) : undefined;
    const want: Tab = cur ? (isWeaponTab(cur) ? 'weapons' : 'systems') : (tab === 'systems' ? 'systems' : 'weapons');
    if (cur) pinned[want] = { kind: 'module', id: cur.id };
    if (tab !== want) { tab = want; saveTab(want); hoverInspect = null; }
    sfx('click');
    update();
  }

  // ---------------- drag & drop ----------------
  let drag: null | {
    src: DragSrc; pid: number; x0: number; y0: number; started: boolean; ghost: HTMLElement | null; hot: number | null; origin: HTMLElement;
    timer: number;
  } = null;
  /** swallow the click that follows a drag */
  let suppressClick = false;

  /** Make `node` a drag source. Mouse drags start on movement; touch drags start on a short press-and-hold
   *  (so lists still scroll), except on `immediate` nodes that sit outside scrolling lists. */
  function armDrag(node: HTMLElement, src: () => DragSrc | null, immediate = false) {
    node.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || drag) return;
      const s = src();
      if (!s) return;
      const touch = e.pointerType !== 'mouse';
      const d = { src: s, pid: e.pointerId, x0: e.clientX, y0: e.clientY, started: false, ghost: null, hot: null, origin: node, timer: 0 };
      drag = d;
      track(immediate);
      // capture only once a drag begins, so a plain click still reaches inner buttons (row select / unmount ✕)
      if (touch && !immediate) {
        d.timer = window.setTimeout(() => {
          if (drag !== d || d.started) return;
          try { node.setPointerCapture(d.pid); } catch { /* ignore */ }
          navigator.vibrate?.(12);
          beginDrag(d.x0, d.y0);
        }, 300);
      }
    });
    node.addEventListener('dragstart', (e) => e.preventDefault());
    node.addEventListener('contextmenu', (e) => { if (drag) e.preventDefault(); });
  }

  /** Follow the pointer at window level until the gesture ends: a fast flick leaves the source node before the first
   *  move (no capture yet), and a press that never reaches the node again must not leave a pending drag behind. */
  let untrack: (() => void) | null = null;
  function track(immediate: boolean) {
    untrack?.();
    const mv = (e: PointerEvent) => onDragMove(e, immediate);
    const up = (e: PointerEvent) => onDragEnd(e);
    const cc = (e: PointerEvent) => { if (drag && e.pointerId === drag.pid) cancelDrag(); };
    window.addEventListener('pointermove', mv, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cc);
    untrack = () => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cc);
      untrack = null;
    };
  }

  function sockets(): { i: number; el: HTMLElement }[] {
    return [...el.querySelectorAll<HTMLElement>('[data-sock]')].map((n) => ({ i: Number(n.dataset.sock), el: n }));
  }

  function hitSocket(x: number, y: number): number | null {
    let best: number | null = null, bd = Infinity;
    for (const s of sockets()) {
      const r = s.el.getBoundingClientRect();
      if (rangesOn && s.el.classList.contains('g-sock')) continue; // hidden while the range view is up
      const pad = s.el.classList.contains('g-sock') ? 14 : 2;
      if (x < r.left - pad || x > r.right + pad || y < r.top - pad || y > r.bottom + pad) continue;
      const d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
      if (d < bd) { bd = d; best = s.i; }
    }
    return best;
  }

  function beginDrag(x: number, y: number) {
    if (!drag || drag.started) return;
    drag.started = true;
    try { if (!drag.origin.hasPointerCapture(drag.pid)) drag.origin.setPointerCapture(drag.pid); } catch { /* ignore */ }
    const mod = MODULE_BY_ID.get(drag.src.mod)!;
    drag.ghost = h('div.g-ghost', { style: { '--cat': moduleCategoryColor(mod.id) } },
      partIcon('module', mod.id, 52, true), h('span', null, mod.name), h('span.g-chip', { class: `c${mod.mount}` }, ML[mod.mount]));
    document.body.append(drag.ghost);
    el.classList.add('dragging');
    if (drag.src.from !== null) el.classList.add('drag-out');
    for (const s of sockets()) {
      const why = s.i === drag.src.from ? null : slotBlock(mod, s.i);
      s.el.classList.toggle('can', !why);
      s.el.classList.toggle('cant', !!why);
    }
    moveGhost(x, y);
  }

  function moveGhost(x: number, y: number) {
    if (!drag?.ghost) return;
    drag.ghost.style.transform = `translate(${x + 14}px, ${y + 10}px)`;
    const hot = hitSocket(x, y);
    if (hot === drag.hot) return;
    drag.hot = hot;
    for (const s of sockets()) s.el.classList.toggle('hot', s.i === hot);
    drag.ghost.classList.toggle('bad', hot !== null && hot !== drag.src.from && !!slotBlock(MODULE_BY_ID.get(drag.src.mod)!, hot));
    drag.ghost.classList.toggle('del', hot === null && drag.src.from !== null);
    if (hot !== null) sfx('hover');
  }

  function onDragMove(e: PointerEvent, immediate: boolean) {
    if (!drag || e.pointerId !== drag.pid) return;
    if (!drag.started) {
      const far = Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0);
      if (e.pointerType !== 'mouse' && !immediate) {
        // finger moved before the hold timer: it's a scroll, not a drag
        if (far > 8) { clearTimeout(drag.timer); drag = null; untrack?.(); }
        return;
      }
      if (far < 6) return;
      beginDrag(e.clientX, e.clientY);
    }
    e.preventDefault();
    moveGhost(e.clientX, e.clientY);
  }

  function clearDragUi(ghost = drag?.ghost) {
    ghost?.remove();
    el.classList.remove('dragging', 'drag-out');
    for (const s of sockets()) s.el.classList.remove('can', 'cant', 'hot');
    applyPick();
  }

  /** While a module is selected in the bay (not dragging), light up the sockets it can legally go in. */
  function applyPick() {
    if (drag?.started) return;
    const sel = tab === 'weapons' || tab === 'systems' ? pinned[tab] : null;
    const mod = sel?.kind === 'module' ? MODULE_BY_ID.get(sel.id) : undefined;
    el.classList.toggle('picking', !!mod);
    for (const s of sockets()) {
      const why = mod ? slotBlock(mod, s.i) : null;
      s.el.classList.toggle('can', !!mod && !why);
      s.el.classList.toggle('cant', !!mod && !!why);
      if (mod) s.el.dataset.why = why ?? ''; else delete s.el.dataset.why;
    }
  }

  function cancelDrag() {
    untrack?.();
    if (drag) clearTimeout(drag.timer);
    clearDragUi();
    drag = null;
  }

  function onDragEnd(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pid) return;
    const d = drag;
    drag = null;
    untrack?.();
    clearTimeout(d.timer);
    if (!d.started) return;
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    clearDragUi(d.ghost);
    const mod = MODULE_BY_ID.get(d.src.mod)!;
    const to = hitSocket(e.clientX, e.clientY);
    if (to === null) {
      if (d.src.from !== null) { equip(d.src.from, null); app.toast(`${mod.name} unmounted`); }
      return;
    }
    if (d.src.from !== null) { moveSlot(d.src.from, to); return; }
    const why = slotBlock(mod, to);
    if (why) { sfx('invalid'); app.toast(why, 'error'); return; }
    pinned[isWeaponTab(mod) ? 'weapons' : 'systems'] = { kind: 'module', id: mod.id };
    equip(to, mod.id);
  }

  // ---------------- rendering ----------------
  function update() {
    const fk = (document.activeElement as HTMLElement | null)?.dataset?.fk;
    if (activeSlot !== null && activeSlot >= chassis().mounts.length) activeSlot = null;
    renderHeader();
    renderList();
    renderClasses();
    renderBench();
    renderSockets();
    renderBay();
    applyPick();
    if (fk) (el.querySelector(`[data-fk="${fk}"]`) as HTMLElement | null)?.focus({ preventScroll: true });
  }

  function renderHeader() {
    deckChip.replaceChildren(icon('deck'), 'Deck ', h('b', null, String(deck.length)), `/${DECK_SIZE}`);
    deckChip.classList.toggle('full', deck.length >= DECK_SIZE);
  }

  function renderClasses() {
    const cur = designDomain(draft);
    classEl.replaceChildren(h('span.g-classes-k', null, h('b', null, '1'), 'Unit class'), ...DOMAINS.map((dm) => h('button.g-class', {
      type: 'button', role: 'radio', 'aria-checked': String(dm.id === cur), class: dm.id === cur ? `on d-${dm.id}` : `d-${dm.id}`,
      'data-fk': `class-${dm.id}`, title: dm.desc, onclick: () => pickDomain(dm.id),
    },
    h('span.g-class-well', null, partIcon('chassis', DOMAIN_ICON[dm.id], 44, true)),
    h('span.g-class-txt', null, h('b', null, DOMAIN_SHORT[dm.id]), h('small', null, dm.desc)))));
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
        h('span.g-item-name', null, h('span.g-item-nm', { title: d.name || 'Untitled' }, d.name || 'Untitled'), opts.unsaved ? h('i.g-dot', { title: 'Unsaved changes' }) : null),
        h('span.g-item-meta', null,
          h('span.g-tag.dom', { class: `d-${designDomain(d)}`, title: DOMAINS.find((x) => x.id === designDomain(d))?.name ?? '' }, DOMAIN_BADGE[designDomain(d)]),
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

  function delta(v: number | null, opts: { invert?: boolean; digits?: number } = {}): HTMLElement | null {
    if (v === null || Math.abs(v) < 1e-6) return null;
    const r = Math.round(v * 10 ** (opts.digits ?? 0)) / 10 ** (opts.digits ?? 0);
    if (r === 0) return null;
    const good = opts.invert ? v < 0 : v > 0;
    return h('span.g-delta', { class: good ? 'up' : 'down' }, `${v > 0 ? '+' : ''}${fmt(v, opts.digits ?? 0)}`);
  }

  function gauge(label: string, value: string, d: HTMLElement | null, opts: { unit?: string; cls?: string; tip?: string; sub?: string } = {}) {
    return h('div.g-gauge', { class: opts.cls ?? null, title: opts.tip ?? null },
      h('span.g-gauge-l', null, label),
      h('span.g-gauge-v', null, value, opts.unit ? h('small', null, opts.unit) : null),
      opts.sub ? h('span.g-gauge-s', null, opts.sub) : null,
      d);
  }

  function renderBench() {
    const s = statsOf(draft);
    const ss = saved && dirty() ? statsOf(saved) : null;
    const errs = validateDesign(draft);
    const isDirty = dirty();
    saveBtn.disabled = errs.length > 0 || !isDirty;
    saveBtn.title = errs.length ? errs[0] : isDirty ? 'Save design (Ctrl+S)' : 'No changes';
    revertBtn.hidden = !(saved && isDirty);
    nameInput.classList.toggle('bad', !draft.name.trim());
    errorsEl.replaceChildren(...errs.map((e) => h('li', null, e)));

    const c = chassis();
    stageTags.replaceChildren(...[
      h('span.g-plate.big', { title: `${c.name}: ${footDims(c)} footprint` }, h('b', null, sizeLabel(c.size, c.footprint?.[0], c.footprint?.[1])), ` ${footDims(c)}`),
      s && s.squad > 1 ? h('span.g-plate.squad', { title: `One purchase deploys a block of ${s.squad} units with adjustable spacing` }, `Squad ×${s.squad}`) : null,
      s?.flying ? h('span.g-plate.air', null, icon('air'), 'Flying') : null,
      s?.isStatic ? h('span.g-plate.static', null, icon('static'), 'Static') : null,
      isDirty ? h('span.g-plate.warn', null, selectedId ? 'Modified' : 'Unsaved') : null,
    ].filter((x): x is HTMLSpanElement => !!x));
    stageCost.replaceChildren(h('span.g-prev-cost-l', null, s && s.squad > 1 ? `Supply / block · ${s.unitCost} each` : 'Supply'), h('span.g-prev-cost-v', null, icon('cost'), h('b', null, s ? String(s.cost) : '–'), delta(ss && s ? s.cost - ss.cost : null, { invert: true })));
    const empty = draft.mounts.filter((m, i) => !m && i < c.mounts.length).length + Math.max(0, c.mounts.length - draft.mounts.length);
    stageHint.replaceChildren(empty ? `Drag parts onto the ${empty} empty socket${empty > 1 ? 's' : ''}` : 'Drag a part onto a socket to swap it');
    rangeBtn.classList.toggle('on', rangesOn);
    rangeBtn.setAttribute('aria-pressed', String(rangesOn));
    stage.classList.toggle('ranges', rangesOn);

    renderLoadout();

    if (!s) { readoutEl.replaceChildren(); loadEl.replaceChildren(); return; }
    const sub = (...xs: (string | null | false)[]) => xs.filter(Boolean).join(' · ');
    readoutEl.replaceChildren(
      gauge('Health', String(s.hp), delta(ss ? s.hp - ss.hp : null), {
        sub: sub(s.armor ? `${s.armor} armor` : 'no armor', s.shield ? `${s.shield} shield` : null),
        tip: 'Hull hit points. Armor subtracts from every hit; shields soak damage and recharge.',
      }),
      gauge('Firepower', String(s.dps), delta(ss ? s.dps - ss.dps : null), {
        unit: 'dps', cls: 'hl', sub: s.range ? `reach ${fmtMeters(s.range)}` : 'unarmed',
        tip: 'Damage per second of all weapons combined; reach is the longest weapon range.',
      }),
      gauge('Speed', s.isStatic ? '—' : String(Math.round(s.speed * METERS_PER_CELL)), delta(ss ? (s.speed - ss.speed) * METERS_PER_CELL : null), {
        unit: s.isStatic ? '' : 'm/s', sub: s.isStatic ? 'static emplacement' : `turns ${deg(s.turn)}°/s`,
      }),
      ...(s.heal ? [gauge('Repair', String(s.heal), delta(ss ? s.heal - ss.heal : null), { unit: 'hp/s', sub: 'to nearby allies' })] : []),
    );

    const pct = s.load * 100;
    const zone = s.load > MAX_LOAD ? 'red' : s.load > 1 ? 'amber' : 'green';
    const f = loadSpeedFactor(s.load);
    const spd = Math.round((f - 1) * 100);
    const mob = MOBILITY_BY_ID.get(draft.mobility);
    const speedNote = s.isStatic ? 'Immobile emplacement'
      : s.load > MAX_LOAD ? 'Overloaded — illegal'
      : spd >= 0 ? `+${spd}% speed` : `${spd}% speed`;
    loadEl.className = `g-load ${zone}`;
    loadEl.style.setProperty('--z1', `${(100 / BAR_MAX).toFixed(2)}%`);
    loadEl.style.setProperty('--z2', `${(MAX_LOAD * 100 / BAR_MAX).toFixed(2)}%`);
    loadEl.replaceChildren(
      h('span.g-load-k', null, icon('weight'), 'Load'),
      h('div.g-bar', {
        role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': String(Math.round(MAX_LOAD * 100)), 'aria-valuenow': String(Math.round(pct)),
        'aria-label': `Load ${Math.round(pct)} percent`, title: `${mob?.name ?? ''} carries ${s.capacity} at full speed`,
      },
      h('div.g-bar-fill', { style: { width: `${Math.min(100, (s.load / BAR_MAX) * 100).toFixed(2)}%` } }),
      h('span.g-bar-mark.m1'), h('span.g-bar-mark.m2'),
      ),
      h('span.g-load-num', null, h('b', null, fmt(s.weight)), `/${s.capacity}`),
      h('span.g-speednote', { class: spd < 0 || s.load > MAX_LOAD ? 'neg' : 'pos' }, speedNote),
    );
  }

  /** Socket strip under the stage: a big, list-shaped twin of the on-hull sockets (also a drop target). */
  function renderLoadout() {
    const c = chassis();
    loadoutEl.replaceChildren(...c.mounts.map((cls, i) => {
      const cur = draft.mounts[i] ? MODULE_BY_ID.get(draft.mounts[i]!) : undefined;
      const card = h('div.g-lslot', {
        role: 'listitem', 'data-sock': String(i),
        class: [cur ? `k-${cur.kind}` : 'empty', activeSlot === i ? 'active' : '', isEdge(i) ? 'edge' : ''].join(' '),
        style: cur ? { '--cat': moduleCategoryColor(cur.id) } : null,
      },
      h('button.g-lslot-main', {
        type: 'button', 'data-fk': `slot-${i}`, 'aria-pressed': String(activeSlot === i),
        title: cur ? `${cur.name} — drag to another socket to swap, or off the robot to remove` : `Empty size ${ML[cls]} socket — drag a part here or click to choose`,
        onclick: () => { if (!suppressClick) focusSlot(i); },
      },
      h('span.g-sockno', null, String(i + 1)),
      h('span.g-chip', { class: `c${cls}`, title: sizeTip(cls) }, ML[cls]),
      cur ? partIcon('module', cur.id, 30, true) : h('span.g-lslot-empty', null, icon('plus')),
      h('span.g-lslot-name', null, cur ? cur.name : 'Empty'),
      isEdge(i) ? h('span.g-lslot-edge', { title: 'Edge mount: fits melee weapons' }, '\u2694 edge') : null,
      ),
      cur ? h('button.g-lslot-x', { type: 'button', title: `Unmount ${cur.name}`, 'aria-label': `Unmount ${cur.name} from socket ${i + 1}`, 'data-fk': `unmount-${i}`, onclick: () => equip(i, null) }, icon('x')) : null,
      );
      if (cur) armDrag(card, () => (draft.mounts[i] ? { mod: draft.mounts[i]!, from: i } : null), true);
      return card;
    }));
  }

  /** On-hull sockets (positions are synced to the renderer every frame). */
  function renderSockets() {
    const c = chassis();
    socketsEl.replaceChildren(...c.mounts.map((cls, i) => {
      const cur = draft.mounts[i] ? MODULE_BY_ID.get(draft.mounts[i]!) : undefined;
      const b = h('button.g-sock', {
        type: 'button', 'data-sock': String(i), tabindex: '-1',
        class: [cur ? 'full' : 'empty', `c${cls}`, activeSlot === i ? 'active' : '', isEdge(i) ? 'edge' : ''].join(' '),
        style: cur ? { '--cat': moduleCategoryColor(cur.id) } : null,
        title: (cur ? `Socket ${i + 1} (size ${ML[cls]}): ${cur.name}` : `Socket ${i + 1}: empty size ${ML[cls]} socket`) + (isEdge(i) ? ' — Edge mount: fits melee weapons' : ''),
        'aria-label': cur ? `Socket ${i + 1}, ${cur.name}` : `Socket ${i + 1}, empty size ${ML[cls]}`,
        onclick: () => { if (!suppressClick) focusSlot(i); },
      },
      h('span.g-sock-ring'),
      h('span.g-sock-tag', null, h('b', null, String(i + 1)), ML[cls]),
      cur ? null : h('span.g-sock-plus', null, '+'),
      isEdge(i) ? h('span.g-sock-edge', { 'aria-hidden': 'true' }, '\u2694') : null,
      );
      if (cur) armDrag(b, () => (draft.mounts[i] ? { mod: draft.mounts[i]!, from: i } : null), true);
      return b;
    }));
    lastSockKey = '';
  }

  let showAllMods = false;
  let lastSockKey = '';
  function placeSockets() {
    if (!geom) return;
    const key = geom.mounts.map((m) => `${m.x.toFixed(1)},${m.y.toFixed(1)},${m.r.toFixed(1)}`).join('|');
    if (key === lastSockKey) return;
    lastSockKey = key;
    const kids = socketsEl.children;
    geom.mounts.forEach((m, i) => {
      const n = kids[i] as HTMLElement | undefined;
      if (!n) return;
      const r = Math.max(15, Math.min(48, m.r * 1.1));
      n.style.left = `${m.x}px`;
      n.style.top = `${m.y}px`;
      n.style.setProperty('--r', `${r.toFixed(1)}px`);
    });
  }

  // ---------------- parts bay ----------------
  function renderBay() {
    const counts: Partial<Record<Tab, string>> = {
      weapons: String(draft.mounts.filter((m) => m && isWeaponTab(MODULE_BY_ID.get(m)!)).length),
      systems: String(draft.mounts.filter((m) => m && !isWeaponTab(MODULE_BY_ID.get(m)!)).length),
    };
    tabsEl.replaceChildren(...TABS.map((t) => h('button.g-tab', {
      type: 'button', role: 'tab', 'aria-selected': String(t.id === tab), class: t.id === tab ? 'on' : null,
      'data-fk': `tab-${t.id}`, title: `${t.tip} (${t.key})`,
      onclick: () => setTab(t.id),
      onkeydown: (e: KeyboardEvent) => {
        const k = TABS.findIndex((x) => x.id === tab);
        if (e.key === 'ArrowRight') { e.preventDefault(); setTab(TABS[(k + 1) % TABS.length].id, true); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); setTab(TABS[(k + TABS.length - 1) % TABS.length].id, true); }
      },
    }, svgIcon(TAB_ICON[t.id]), h('span.g-tab-l', null, t.label), counts[t.id] && counts[t.id] !== '0' ? h('small', null, counts[t.id]!) : null)));

    bayBody.className = `g-baybody t-${tab}`;
    inspector.hidden = tab === 'orders' || tab === 'intel';
    if (tab === 'hull') bayBody.replaceChildren(...renderHullTab());
    else if (tab === 'drive') bayBody.replaceChildren(...renderDriveTab());
    else if (tab === 'weapons' || tab === 'systems') bayBody.replaceChildren(...renderModuleTab(tab));
    else if (tab === 'orders') bayBody.replaceChildren(renderOrders());
    else bayBody.replaceChildren(...renderIntel());
    renderInspector();
  }

  function hoverable(node: HTMLElement, it: Inspect) {
    node.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse' && !drag?.started) { hoverInspect = it; renderInspector(); } });
    node.addEventListener('pointerleave', () => { if (hoverInspect && hoverInspect.id === it.id) { hoverInspect = null; renderInspector(); } });
    node.addEventListener('focus', () => { hoverInspect = it; renderInspector(); });
    node.addEventListener('blur', () => { if (hoverInspect && hoverInspect.id === it.id) { hoverInspect = null; renderInspector(); } });
  }

  /** Single-choice role dropdown (shared by every tab). */
  function roleSelect(): HTMLElement {
    return kit.select({
      value: roleSel, label: 'Filter by role', prefix: 'Role', fk: 'role', className: 'g-rolesel',
      options: [{ value: '*', label: 'Any' }, ...ROLES.map((r) => ({ value: r.id as string, label: r.name, hint: r.desc }))],
      onChange: (v) => { roleSel = v; sfx('click'); update(); },
    });
  }
  const roleOk = (roles: readonly string[]) => roleSel === '*' || roles.includes(roleSel);

  /** Collapsed tail of a list ("4 need bigger sockets ▸"). */
  function overflow(key: string, label: string, tiles: HTMLElement[]): HTMLElement[] {
    if (!tiles.length) return [];
    const open = openMore.has(key);
    return [
      h('button.g-more', {
        type: 'button', 'aria-expanded': String(open), 'data-fk': `more-${key}`,
        onclick: () => { if (open) openMore.delete(key); else openMore.add(key); sfx('click'); update(); },
      }, h('span.g-more-c', null, open ? '▾' : '▸'), `${tiles.length} ${label}`),
      ...(open ? [h('div.g-ptiles.g-dimmed', null, ...tiles)] : []),
    ];
  }

  function partTile(o: {
    kind: 'chassis' | 'mobility' | 'module'; id: string; name: string; sub: string; chip?: MountClass; cat?: string;
    cls: string; fk: string; title?: string; count?: number; onclick: () => void; ondblclick?: () => void; onkeydown?: (e: KeyboardEvent) => void;
  }): HTMLButtonElement {
    const t = h('button.g-ptile', {
      type: 'button', class: o.cls, 'data-fk': o.fk, title: o.title ?? null, style: o.cat ? { '--cat': o.cat } : null,
      onclick: () => { if (!suppressClick) o.onclick(); }, ondblclick: o.ondblclick ?? null, onkeydown: o.onkeydown ?? null,
    },
    h('span.g-ptile-well', null, partIcon(o.kind, o.id, 50, o.kind === 'module'), o.chip ? h('span.g-chip.mini', { class: `c${o.chip}`, title: sizeTip(o.chip) }, ML[o.chip]) : null),
    h('span.g-ptile-name', null, o.name),
    h('span.g-ptile-sub', null, o.sub),
    o.count ? h('span.g-tile-n', { title: `Mounted ${o.count}×` }, `×${o.count}`) : null,
    );
    hoverable(t, { kind: o.kind, id: o.id });
    return t;
  }

  function renderHullTab(): HTMLElement[] {
    const pool = domainChassis(designDomain(draft));
    const sizes = [...new Set(pool.map((c) => c.size))].sort((a, b) => a - b);
    if (sizeSel !== 0 && !sizes.includes(sizeSel as ChassisDef['size'])) sizeSel = 0;
    const shown = pool.filter((c) => c.id === draft.chassis || ((sizeSel === 0 || c.size === sizeSel) && roleOk(c.roles)))
      .sort((a, b) => a.size - b.size || a.weight - b.weight);
    const tiles = shown.map((c) => partTile({
      kind: 'chassis', id: c.id, name: c.name, sub: `${footDims(c)} · socket${c.mounts.length > 1 ? 's' : ''} ${[...c.mounts].sort((x, y) => RANK[y] - RANK[x]).map((m) => ML[m]).join(' ')}`,
      cls: [c.id === draft.chassis ? 'sel' : '', pinned.hull?.id === c.id ? 'pin' : ''].join(' '), fk: `ch-${c.id}`,
      onclick: () => pickChassis(c.id),
    }));
    return [
      h('div.g-baytools', null,
        kit.segmented({
          value: sizeSel, label: 'Hull size', fk: 'hsize', className: 'g-subtabs',
          options: [{ value: 0, label: 'All' }, ...sizes.map((z) => ({ value: z as number, label: footprintLabel(z), title: `${SIZE_CLASSES[z - 1]} hulls, ${footprintLabel(z)} across` }))],
          onChange: (v) => { sizeSel = v; sfx('click'); update(); },
        }),
        roleSelect()),
      h('div.g-ptiles', { role: 'group', 'aria-label': 'Chassis' }, ...tiles),
      shown.length <= 1 ? h('p.g-nomatch', null, 'No other hulls match.') : null,
    ].filter(Boolean) as HTMLElement[];
  }

  function renderDriveTab(): HTMLElement[] {
    const c = chassis();
    const dpool = domainMobility(designDomain(draft));
    const kinds = (['ground', 'air', 'static'] as const).filter((k) => dpool.some((m) => m.kind === k));
    if (driveSel !== '*' && !kinds.includes(driveSel as 'ground')) driveSel = '*';
    const pool = dpool.filter((m) => m.id === draft.mobility || ((driveSel === '*' || m.kind === driveSel) && roleOk(m.roles)))
      .sort((a, b) => a.weight - b.weight);
    const tile = (m: MobilityDef) => {
      const err = pairingError(draft.chassis, m.id);
      const res = err ? null : statsOf({ ...draft, mobility: m.id });
      return partTile({
        kind: 'mobility', id: m.id, name: m.name,
        sub: err ? 'Not for this hull' : m.kind === 'static' ? 'Static' : `${Math.round(res!.speed * METERS_PER_CELL)} m/s`,
        cls: [m.id === draft.mobility ? 'sel' : '', pinned.drive?.id === m.id ? 'pin' : '', err ? 'nofit' : ''].join(' '), fk: `mob-${m.id}`,
        title: err ?? undefined, onclick: () => pickMobility(m.id),
      });
    };
    const fits = pool.filter((m) => !pairingError(draft.chassis, m.id));
    const nofit = pool.filter((m) => pairingError(draft.chassis, m.id));
    return [
      h('div.g-baytools', null,
        kit.segmented({
          value: driveSel, label: 'Drive type', fk: 'dkind', className: 'g-subtabs',
          options: [{ value: '*', label: 'All' }, ...kinds.map((k) => ({ value: k as string, label: KIND_LABEL[k] }))],
          onChange: (v) => { driveSel = v; sfx('click'); update(); },
        }),
        roleSelect()),
      h('p.g-secnote', null, `Lightest first · speeds shown for the ${c.name}`),
      h('div.g-ptiles', { role: 'group', 'aria-label': 'Mobility' }, ...fits.map(tile)),
      ...overflow('drive-nofit', `don't fit the ${c.name}`, nofit.map(tile)),
    ];
  }

  function renderModuleTab(which: 'weapons' | 'systems'): HTMLElement[] {
    const c = chassis();
    const groups = (which === 'weapons' ? WEAPON_GROUPS : SYSTEM_GROUPS).filter((g) => MODULES.some((m) => g.cats.includes(m.category)));
    let gid = groupSel[which];
    if (!groups.some((g) => g.id === gid)) gid = groupSel[which] = groups[0].id;
    const q = modQuery.trim().toLowerCase();
    const counts = new Map<string, number>();
    for (const id of draft.mounts) if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    const fitsHull = (m: ModuleDef) => !noFitReason(m);
    const mountedIn = (g: Group) => draft.mounts.some((id) => id && g.cats.includes(MODULE_BY_ID.get(id)!.category));
    // search looks across the whole tab; otherwise the selected group
    const cats = q ? groups.flatMap((g) => g.cats) : groups.find((g) => g.id === gid)!.cats;
    const pin = pinned[which];
    const tile = (m: ModuleDef) => {
      const fitsActive = activeSlot !== null && !slotBlock(m, activeSlot);
      const fh = fitsHull(m);
      const t = partTile({
        kind: 'module', id: m.id, name: m.name, sub: `${fmt(m.weight)} wt`, chip: m.mount, cat: moduleCategoryColor(m.id), count: counts.get(m.id),
        cls: [pin?.id === m.id ? 'pin' : '', fh ? '' : 'nofit', fitsActive ? 'fitsel' : '', counts.has(m.id) ? 'mounted' : ''].join(' '),
        fk: `mod-${m.id}`, title: fh ? (m.category === 'melee' ? 'Melee: fits edge mounts only' : undefined) : noFitReason(m) ?? undefined,
        onclick: () => { pinned[which] = { kind: 'module', id: m.id }; hoverInspect = null; sfx('click'); update(); },
        ondblclick: () => quickEquip(m.id),
        onkeydown: (e) => { if (e.key === 'Enter' && (e.shiftKey || pinned[which]?.id === m.id)) { e.preventDefault(); quickEquip(m.id); } },
      });
      if (fh) armDrag(t, () => ({ mod: m.id, from: null }));
      return t;
    };
    const sections: HTMLElement[] = [];
    let hiddenN = 0;
    for (const catId of cats) {
      const def = CATEGORIES.find((k) => k.id === catId);
      const mods = MODULES.filter((m) => m.category === catId && ((!q && counts.has(m.id)) || (roleOk(moduleRoles(m)) && (!q || `${m.name} ${m.family} ${def?.name ?? ''}`.toLowerCase().includes(q)))))
        .sort((a, b) => a.weight - b.weight || a.cost - b.cost);
      if (!mods.length) continue;
      const ok = mods.filter(fitsHull), no = mods.filter((m) => !fitsHull(m));
      hiddenN += no.length;
      sections.push(
        h('div.g-sec', { style: { '--cat': CATEGORY_COLOR[catId] ?? '#b0b8c0' } },
          h('span.g-sec-name', null, def?.name ?? catId),
          h('span.g-sec-desc', null, def?.desc ?? '')),
        ...(ok.length ? [h('div.g-ptiles', { role: 'group', 'aria-label': def?.name ?? catId }, ...ok.map(tile))] : []),
        ...(showAllMods && no.length ? [h('div.g-ptiles.g-dimmed', null, ...no.map(tile))] : []),
      );
    }
    const search = kit.textField({
      value: modQuery, placeholder: `Search ${which}`, label: `Search ${which}`, fk: `msearch-${which}`, className: 'g-search',
      icon: svgIcon('<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>'),
      onInput: (v) => {
        modQuery = v;
        const pos = search.input.selectionStart;
        update();
        const again = el.querySelector<HTMLInputElement>(`[data-fk="msearch-${which}"]`);
        again?.focus();
        if (pos != null) again?.setSelectionRange(pos, pos);
      },
      onClear: () => { modQuery = ''; update(); el.querySelector<HTMLInputElement>(`[data-fk="msearch-${which}"]`)?.focus(); },
    });
    const slotCls = activeSlot !== null ? c.mounts[activeSlot] : null;
    return [
      h('div.g-baytools', null, search.el, roleSelect()),
      q ? h('p.g-secnote', null, `Searching all ${which}`) : kit.segmented({
        value: gid, label: `${which} group`, fk: `grp-${which}`, className: 'g-subtabs full',
        options: groups.map((g) => ({ value: g.id, label: h('span', null, g.label, mountedIn(g) ? h('i.g-gdot', { title: 'Something from this group is mounted' }) : null), title: g.tip })),
        onChange: (v) => { groupSel[which] = v; sfx('click'); update(); bayBody.scrollTop = 0; },
      }),
      activeSlot !== null ? h('div.g-slotnote', null,
        h('span', null, 'Fitting socket ', h('b', null, String(activeSlot + 1)), ' ', h('span.g-chip', { class: `c${slotCls}` }, ML[slotCls!]), ' · double-click a part to mount it'),
        h('button.g-rclear', { type: 'button', onclick: () => { activeSlot = null; sfx('click'); update(); } }, icon('x'), 'Done')) : null,
      hiddenN || showAllMods ? h('button.g-showall', {
        type: 'button', 'aria-pressed': String(showAllMods), 'data-fk': 'showall',
        title: 'Parts that fit no socket on this chassis + drive are hidden; show them greyed out',
        onclick: () => { showAllMods = !showAllMods; sfx('click'); update(); },
      }, showAllMods ? 'Hide unusable parts' : `Show all (${hiddenN} hidden)`) : null,
      ...(sections.length ? sections : [h('p.g-nomatch', null, `No ${which} match.`)]),
    ].filter(Boolean) as HTMLElement[];
  }

  // ---------------- inspector ----------------
  function currentInspect(): Inspect | null {
    if (hoverInspect) return hoverInspect;
    if (tab === 'hull') return pinned.hull ?? { kind: 'chassis', id: draft.chassis };
    if (tab === 'drive') return pinned.drive ?? { kind: 'mobility', id: draft.mobility };
    if (tab === 'weapons' || tab === 'systems') {
      if (pinned[tab]) return pinned[tab]!;
      const id = activeSlot !== null ? draft.mounts[activeSlot] : null;
      if (id) return { kind: 'module', id };
      const first = draft.mounts.find((m) => m && isWeaponTab(MODULE_BY_ID.get(m)!) === (tab === 'weapons'));
      return first ? { kind: 'module', id: first } : null;
    }
    return null;
  }

  function renderInspector() {
    if (tab === 'orders' || tab === 'intel') return;
    const it = currentInspect();
    if (!it) {
      inspector.replaceChildren(h('div.g-insp-empty', null,
        h('b', null, 'Pick a part'),
        h('span', null, 'Hover or click a part for its spec sheet. Drag it onto a socket on the robot to mount it.')));
      return;
    }
    if (it.kind === 'chassis') inspector.replaceChildren(...inspectChassis(CHASSIS_BY_ID.get(it.id)!));
    else if (it.kind === 'mobility') inspector.replaceChildren(...inspectMobility(MOBILITY_BY_ID.get(it.id)!));
    else inspector.replaceChildren(...inspectModule(MODULE_BY_ID.get(it.id)!));
  }

  const row = (k: string, v: Node | string, extra?: Node | null) => h('div.g-spec', null, h('span.g-spec-k', null, k), h('span.g-spec-v', null, v, extra ?? null));
  /** Headline number: label on top, big value. */
  const kstat = (label: string, value: Node | string, unit = '', cls = '') =>
    h('div.g-kstat', { class: cls || null }, h('span.g-kstat-l', null, label), h('span.g-kstat-v', null, value, unit ? h('small', null, unit) : null));

  /** What changes on this design — only the numbers that actually move. */
  function compare(next: Design, title: string): HTMLElement | null {
    const a = statsOf(draft), b = statsOf(next);
    if (!a || !b) return null;
    const cells: HTMLElement[] = [];
    const cell = (k: string, va: number, vb: number, opts: { invert?: boolean; unit?: string; digits?: number } = {}) => {
      const d = vb - va;
      if (Math.abs(d) < 0.5 * 10 ** -(opts.digits ?? 0)) return;
      cells.push(h('div.g-cmp-c', null, h('span', null, k), h('b', null, `${fmt(vb, opts.digits ?? 0)}${opts.unit ?? ''}`), delta(d, opts)));
    };
    cell('Cost', a.cost, b.cost, { invert: true });
    cell('DPS', a.dps, b.dps);
    cell('HP', a.hp, b.hp);
    cell('Range', a.range * METERS_PER_CELL, b.range * METERS_PER_CELL, { unit: 'm' });
    cell('Speed', a.speed * METERS_PER_CELL, b.speed * METERS_PER_CELL);
    cell('Load', a.load * 100, b.load * 100, { invert: true, unit: '%' });
    if (!cells.length) return null;
    return h('div.g-insp-sec', null, h('span.g-sec-l', null, title), h('div.g-cmp', null, ...cells.slice(0, 5)));
  }

  function inspHead(kind: 'chassis' | 'mobility' | 'module', id: string, name: string, sub: (Node | string | null)[], color?: string) {
    return h('div.g-insp-h', { style: color ? { '--cat': color } : null },
      h('span.g-insp-well', null, partIcon(kind, id, 60, kind === 'module')),
      h('div.g-insp-t', null, h('h3', null, name), h('div.g-insp-sub', null, ...sub)),
    );
  }

  /** "Full specs" disclosure, open state remembered. */
  function details(rows: (HTMLElement | null)[], extra: (HTMLElement | null)[] = []): HTMLElement[] {
    const btn = h('button.g-more.g-details', {
      type: 'button', 'aria-expanded': String(showDetails), 'data-fk': 'details',
      onclick: () => { showDetails = !showDetails; try { localStorage.setItem(LS_DETAILS, showDetails ? '1' : '0'); } catch { /* ignore */ } sfx('click'); renderInspector(); (inspector.querySelector('[data-fk="details"]') as HTMLElement | null)?.focus(); },
    }, h('span.g-more-c', null, showDetails ? '▾' : '▸'), 'Full specs');
    return showDetails ? [btn, h('div.g-specs', null, ...rows.filter(Boolean) as HTMLElement[]), ...extra.filter(Boolean) as HTMLElement[]] : [btn];
  }

  function inspectChassis(c: ChassisDef): HTMLElement[] {
    const cur = c.id === draft.chassis;
    const next = cur ? null : (() => {
      const mobility = pairingError(c.id, draft.mobility) ? firstLegalMobility(c.id) : draft.mobility;
      return { ...draft, chassis: c.id, mobility, mounts: reseat(draft.mounts, c, mobility) };
    })();
    return [
      inspHead('chassis', c.id, c.name, [h('span.g-plate', null, footDims(c, true)), roleTags(c.roles, 2)]),
      h('div.g-kstats', null,
        kstat('Hull', String(c.hp), 'hp'),
        kstat('Armor', String(c.armor)),
        kstat('Sockets', h('span.g-chips', null, ...c.mounts.map((m) => h('span.g-chip', { class: `c${m}`, title: sizeTip(m) }, ML[m]))))),
      h('p.g-insp-desc', null, c.desc),
      next ? compare(next, 'If you switch') : null,
      h('div.g-insp-act', null, cur
        ? h('span.g-current', null, icon('check'), 'Current hull')
        : h('button.g-btn.primary', { type: 'button', onclick: () => pickChassis(c.id) }, 'Use this hull')),
      ...details([
        row('Weight', String(c.weight)),
        row('Agility', `×${c.agility.toFixed(2)}`),
        row('Base cost', h('span.g-costv', null, icon('cost'), String(c.cost))),
        row('Drives', MOBILITY.filter((m) => !pairingError(c.id, m.id)).map((m) => m.name).join(', ')),
      ], [c.traits.length ? h('div.g-fxs', null, ...c.traits.map((t) => h('span.g-fx', null, TRAIT_LABEL[t] ?? t))) : null]),
    ].filter(Boolean) as HTMLElement[];
  }

  function inspectMobility(m: MobilityDef): HTMLElement[] {
    const c = chassis();
    const err = pairingError(draft.chassis, m.id);
    const cur = m.id === draft.mobility;
    const next = err || cur ? null : { ...draft, mobility: m.id };
    const res = err ? null : statsOf({ ...draft, mobility: m.id });
    return [
      inspHead('mobility', m.id, m.name, [h('span.g-plate', null, KIND_LABEL[m.kind]), roleTags(m.roles, 2)]),
      h('div.g-kstats', null,
        kstat('Speed', m.kind === 'static' ? '—' : String(Math.round((res?.speed ?? m.speed) * METERS_PER_CELL)), m.kind === 'static' ? '' : 'm/s'),
        kstat('Carries', m.capacity[c.size - 1] ? String(m.capacity[c.size - 1]) : 'n/a', 'wt'),
        kstat('Turn', m.kind === 'static' ? '—' : String(deg(m.turn)), m.kind === 'static' ? '' : '°/s')),
      h('p.g-insp-desc', null, m.desc),
      err ? h('p.g-insp-err', null, err) : null,
      next ? compare(next, 'If you switch') : null,
      h('div.g-insp-act', null, cur
        ? h('span.g-current', null, icon('check'), 'Current drive')
        : h('button.g-btn.primary', { type: 'button', disabled: !!err, onclick: () => pickMobility(m.id) }, 'Use this drive')),
      ...details([
        row('Weight', String(m.weight * c.size)),
        row('Hull bonus', `+${m.hp * c.size} hp${m.armor ? ` · +${m.armor} arm` : ''}`),
        row('Cost', h('span.g-costv', null, icon('cost'), String(m.cost * c.size))),
      ], [m.traits.length ? h('div.g-fxs', null, ...m.traits.map((t) => h('span.g-fx', null, TRAIT_LABEL[t] ?? t))) : null]),
    ].filter(Boolean) as HTMLElement[];
  }

  function inspectModule(m: ModuleDef): HTMLElement[] {
    const c = chassis();
    const catName = CATEGORIES.find((k) => k.id === m.category)?.name ?? m.category;
    const keys: HTMLElement[] = [];
    const specs: (HTMLElement | null)[] = [];
    if (m.kind === 'weapon') {
      keys.push(
        kstat('DPS', fmt(weaponDps(m), 0), '', 'hl'),
        kstat('Range', m.minRange ? `${Math.round(m.minRange * METERS_PER_CELL)}–${Math.round((m.range ?? 0) * METERS_PER_CELL)}` : String(Math.round((m.range ?? 0) * METERS_PER_CELL)), 'm'),
        kstat('Hits', h('span.g-tgts', null,
          h('span', { class: m.targetsGround ? 'on' : 'off', title: m.targetsGround ? 'Hits ground units' : "Can't hit ground units" }, icon('ground'), 'Gnd'),
          h('span', { class: m.targetsAir ? 'on' : 'off', title: m.targetsAir ? 'Hits aircraft' : "Can't hit aircraft" }, icon('air'), 'Air'))),
      );
      const per = `${m.damage ?? 0}${m.pellets && m.pellets > 1 ? ` ×${m.pellets}` : ''}${m.burst && m.burst > 1 ? ` ×${m.burst} burst` : ''}`;
      specs.push(row('Damage', per), row('Firing', firingText(m)), row('Accuracy', accMeter(m)));
      if (m.splash) specs.push(row('Splash', fmtMeters(m.splash)));
      if (m.ap) specs.push(row('Armor pierce', `${Math.round(m.ap * 100)}%`));
    } else {
      if (m.heal) keys.push(kstat('Repair', fmt(m.heal, 0), 'hp/s', 'hl'), kstat('Range', String(Math.round((m.range ?? 0) * METERS_PER_CELL)), 'm'));
      if (m.shield) keys.push(kstat('Shield', String(m.shield), '', 'hl'));
      if (m.armor) keys.push(kstat('Armor', `+${m.armor}`, '', keys.length ? '' : 'hl'));
      if (m.hp) keys.push(kstat('Hull', `+${m.hp}`, 'hp'));
      if (!keys.length) { const fx0 = moduleEffects(m)[0]; if (fx0) keys.push(kstat('Effect', fx0, '', 'hl txt')); }
    }
    keys.push(kstat('Weight', fmt(m.weight)));
    const trav = traverseDeg(m);
    if (trav !== null) specs.push(row('Turret turn', `${trav}°/s`, trav < SLOW_TURRET_DEG ? h('span.g-warnlbl', null, ' slow') : null));
    specs.push(row('Base cost', h('span.g-costv', null, icon('cost'), String(m.cost))));
    const fx = moduleEffects(m);
    const target = autoSlot(m);
    const lock = reqReason(m);
    const next = target !== null && draft.mounts[target] !== m.id ? (() => { const mounts = [...draft.mounts]; mounts[target] = m.id; return { ...draft, mounts }; })() : null;
    const socketBtns = c.mounts.map((cls, i) => {
      const why = slotBlock(m, i);
      const occ = draft.mounts[i] ? MODULE_BY_ID.get(draft.mounts[i]!) : undefined;
      const here = occ?.id === m.id;
      return h('button.g-sockbtn', {
        type: 'button', disabled: !!why || here, class: [i === target && !here ? 'best' : '', here ? 'here' : '', activeSlot === i ? 'active' : ''].join(' '),
        title: why ?? (here ? 'Already mounted here' : occ ? `Replace ${occ.name}` : 'Mount in this empty socket'),
        'data-fk': `mount-${m.id}-${i}`,
        onclick: () => equip(i, m.id),
      }, h('span.g-sockno', null, String(i + 1)), h('span.g-chip', { class: `c${cls}`, title: sizeTip(cls) }, ML[cls]), h('span.g-sockbtn-l', null, here ? 'Mounted' : occ ? `Replace ${occ.name}` : 'Empty'));
    });
    return [
      inspHead('module', m.id, m.name, [h('span.g-plate.cat', null, catName), h('span.g-chip', { class: `c${m.mount}`, title: sizeTip(m.mount) }, ML[m.mount]), m.requires ? h('span.g-plate.warn', null, m.requires === 'air' ? 'Air only' : 'Ground only') : null], moduleCategoryColor(m.id)),
      h('div.g-kstats', null, ...keys.slice(0, 4)),
      h('p.g-insp-desc', null, m.desc),
      next ? compare(next, `If mounted in socket ${target! + 1}`) : null,
      h('div.g-insp-sec', null,
        h('span.g-sec-l', null, lock ?? noFitReason(m) ?? 'Mount in'),
        h('div.g-sockbtns', null, ...socketBtns)),
      ...details(specs, [fx.length ? h('div.g-fxs', null, ...fx.map((t) => h('span.g-fx', null, t))) : null]),
    ].filter(Boolean) as HTMLElement[];
  }

  function accMeter(m: ModuleDef): HTMLElement {
    const a = accuracyRating(m);
    const lbl = accuracyLabel(m);
    return h('span.g-accm', { class: a >= 80 ? 'hi' : a >= 55 ? 'mid' : 'lo' },
      h('span.g-accm-t', null, h('span', { style: { width: `${a}%` } })), h('b', null, lbl ?? `${a}`));
  }

  // ---------------- orders / intel ----------------
  function renderOrders(): HTMLElement {
    const sq = (statsOf(draft)?.squad ?? 1) > 1;
    const ko = kiteOptions(draft);
    const defs = defaultOrders(draft);
    const o0 = ordersOf(draft.behavior, defs);
    // drop a kite weapon that no longer exists in the loadout
    const o = ko.some((k) => k.mount === o0.kiteMount) ? o0 : { ...o0, kiteMount: -1 };
    if (o.kiteMount !== o0.kiteMount) {
      const b = orderFields({ ...o, hold: sq && o.hold }, defs);
      const { behavior: _b, ...rest } = draft;
      draft = Object.keys(b).length ? { ...rest, behavior: b } : rest;
    }
    return h('div.g-orders', null,
      h('p.g-note', null, 'New blocks of this design start with these orders. You can still change them per block on the field.'),
      ordersControl({ ...o, hold: sq && o.hold }, sq, (patch) => {
        const next = { ...o, ...patch };
        const b = orderFields({ ...next, hold: sq && next.hold }, defs);
        const { behavior: _b, ...rest } = draft;
        draft = Object.keys(b).length ? { ...rest, behavior: b } : rest;
        sfx('click');
        update();
      }, { custom: false, kiteOptions: ko, defaults: defs }));
  }

  function renderIntel(): HTMLElement[] {
    const s = statsOf(draft);
    if (!s) return [h('p.g-note', null, 'This design has no valid stats yet.')];
    const ss = saved && dirty() ? statsOf(saved) : null;
    const parts = PARTS_WEIGHT * s.partsCost;
    const pow = POWER_K * s.power;
    const tot = parts + pow || 1;
    const d = (k: 'offense' | 'ehp' | 'partsCost' | 'power') => (ss ? delta(s[k] - ss[k]) : null);
    const c = chassis();
    const weapons = c.mounts.map((cls, i) => ({ cls, i, m: draft.mounts[i] ? MODULE_BY_ID.get(draft.mounts[i]!) : undefined }));
    return [
      h('div.g-insp-sec', null,
        h('span.g-sec-l', null, 'Cost breakdown'),
        h('div.g-costhead', null, icon('cost'), h('b', null, String(s.cost)), h('span', null, s.squad > 1 ? `supply / block of ${s.squad}` : 'supply')),
        h('div.g-cost-bar', { 'aria-hidden': 'true' },
          h('span.parts', { style: { width: `${(parts / tot) * 100}%` } }),
          h('span.power', { style: { width: `${(pow / tot) * 100}%` } })),
        h('div.g-specs', null,
          s.squad > 1 ? row('Per unit value', `${s.unitCost} ×${s.squad}`) : null,
          row('Parts complexity', `${Math.round(s.partsCost)} ≈${Math.round(parts)}`, d('partsCost')),
          row('Combat power', `${s.power} ≈${Math.round(pow)}`, d('power')),
          row('Offense rating', String(s.offense), d('offense')),
          row('Effective HP', String(s.ehp), d('ehp')),
        ),
        h('p.g-note', null, `Cost = ${PARTS_WEIGHT} × parts + ${POWER_K} × power, rounded up to 5. Power = √(offense × effective hp) × mobility, so equal-supply armies are balanced.`),
      ),
      h('div.g-insp-sec', null,
        h('span.g-sec-l', null, 'Hardpoints'),
        h('div.g-hp-table', null, ...weapons.map(({ cls, i, m }) => h('div.g-hp-row', { style: m ? { '--cat': moduleCategoryColor(m.id) } : null },
          h('span.g-sockno', null, String(i + 1)), h('span.g-chip', { class: `c${cls}`, title: sizeTip(cls) }, ML[cls]),
          h('span.g-hp-n', null, m?.name ?? '—'),
          h('span.g-hp-s', null, m?.kind === 'weapon' ? `${fmt(weaponDps(m), 0)} dps · ${fmtMeters(m.range ?? 0)}` : m ? (moduleEffects(m)[0] ?? m.family) : 'empty')))),
      ),
      h('div.g-insp-sec', null,
        h('span.g-sec-l', null, 'Profile'),
        h('div.g-specs', null,
          row('Footprint', `${footprintLabel(s.fw)} × ${footprintLabel(s.fh)}`),
          row('Weight', `${fmt(s.weight)} / ${s.capacity}`),
          row('Turn', s.isStatic ? '—' : `${deg(s.turn)}°/s`),
        ),
        s.traits.length ? h('div.g-fxs', null, ...[...new Set(s.traits)].map((t) => h('span.g-fx', null, TRAIT_LABEL[t] ?? t))) : null,
      ),
    ];
  }

  // ---------------- blueprint grid ----------------
  /** Reach rings for the range overlay (cells): weapons (with the design's range bonus), repair beams and auras. */
  /** Reach rings for the range overlay (cells) — the same rings the battlefield draws (ringsOf), so the sim's rules
   *  apply: range bonus scales guns and repair beams, not melee reach or dead zones. */
  function rangeRings(): { r: number; min: number; color: string; label: string; mounts: number[]; melee: boolean }[] {
    const st = statsOf(draft);
    if (!st) return [];
    return ringsOf(draft, st).map((o) => ({ r: o.range, min: o.minRange, color: o.color, label: o.label, mounts: o.mounts, melee: !!o.melee })).sort((a, b) => b.r - a.r);
  }
  const rangeExtent = () => Math.max(MIN_VIEW_CELLS, ...rangeRings().map((o) => o.r * 2.18 + 1));

  let gridKey = '';
  function drawGrid(g: PreviewGeom) {
    const r = gridCv.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rings = rangesOn ? rangeRings() : [];
    const key = `${r.width}x${r.height}@${dpr}|${g.half.toFixed(1)}|${g.px.toFixed(2)}|${g.cx.toFixed(1)}|${g.cy.toFixed(1)}|${g.S}|${g.fw}x${g.fl}|${rings.map((o) => o.r + o.label + o.mounts.join(":")).join(",")}|${g.mounts.map((q) => `${q.x.toFixed(0)},${q.y.toFixed(0)}`).join(";")}`;
    if (key === gridKey) return;
    gridKey = key;
    gridCv.width = Math.round(r.width * dpr);
    gridCv.height = Math.round(r.height * dpr);
    const x = gridCv.getContext('2d');
    if (!x) return;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = r.width, H = r.height, P = g.px, FW = g.fw, FL = g.fl;
    // footprint is centred on the hull's ground point
    const fx0 = g.cx - (FW / 2) * P, fy0 = g.cy - (FL / 2) * P;
    x.clearRect(0, 0, W, H);
    // 1 m minor lines, 5 m (one cell) major lines, aligned to the footprint
    const sub = P / METERS_PER_CELL;
    if (sub >= 5) {
      x.strokeStyle = 'rgba(120, 190, 230, 0.07)';
      x.lineWidth = 1;
      x.beginPath();
      for (let k = Math.floor(-fx0 / sub); fx0 + k * sub < W; k++) { const X = Math.round(fx0 + k * sub) + 0.5; x.moveTo(X, 0); x.lineTo(X, H); }
      for (let k = Math.floor(-fy0 / sub); fy0 + k * sub < H; k++) { const Y = Math.round(fy0 + k * sub) + 0.5; x.moveTo(0, Y); x.lineTo(W, Y); }
      x.stroke();
    }
    x.strokeStyle = 'rgba(120, 200, 240, 0.2)';
    x.beginPath();
    for (let k = Math.floor(-fx0 / P); fx0 + k * P < W; k++) { const X = Math.round(fx0 + k * P) + 0.5; x.moveTo(X, 0); x.lineTo(X, H); }
    for (let k = Math.floor(-fy0 / P); fy0 + k * P < H; k++) { const Y = Math.round(fy0 + k * P) + 0.5; x.moveTo(0, Y); x.lineTo(W, Y); }
    x.stroke();
    // cell-corner crosses
    x.strokeStyle = 'rgba(160, 220, 255, 0.35)';
    x.beginPath();
    for (let i = Math.floor(-fx0 / P); fx0 + i * P < W; i++) for (let j = Math.floor(-fy0 / P); fy0 + j * P < H; j++) {
      const X = Math.round(fx0 + i * P) + 0.5, Y = Math.round(fy0 + j * P) + 0.5;
      x.moveTo(X - 3, Y); x.lineTo(X + 4, Y); x.moveTo(X, Y - 3); x.lineTo(X, Y + 4);
    }
    x.stroke();
    // footprint
    const fw = FW * P, fl = FL * P;
    x.fillStyle = 'rgba(255, 176, 0, 0.06)';
    x.fillRect(fx0, fy0, fw, fl);
    x.setLineDash([6, 5]);
    x.strokeStyle = 'rgba(255, 176, 0, 0.55)';
    x.lineWidth = 1.5;
    x.strokeRect(Math.round(fx0) + 0.5, Math.round(fy0) + 0.5, Math.round(fw), Math.round(fl));
    x.setLineDash([]);
    // dimension lines (top + left)
    const label = (n: number) => `${n * METERS_PER_CELL} m`;
    x.font = '600 14px "Barlow Condensed", system-ui, sans-serif';
    x.fillStyle = 'rgba(255, 196, 64, 0.95)';
    x.strokeStyle = 'rgba(255, 196, 64, 0.7)';
    x.lineWidth = 1;
    // keep the dimension lines clear of the sprite (giants overhang their footprint)
    const dy = Math.max(14, fy0 - Math.max(16, g.half - (FL / 2) * P + 12));
    dimLine(x, fx0, dy, fx0 + fw, dy, label(FW), false);
    const dx = Math.max(14, fx0 - Math.max(16, g.half - (FW / 2) * P + 12));
    dimLine(x, dx, fy0, dx, fy0 + fl, label(FL), true);
    // range rings
    rings.forEach((o, i) => {
      const R = o.r * P;
      // measured from each weapon's own mount (melee: from the hull centre); several mounts -> rounded outline of all
      const pts = o.melee ? [] : o.mounts.map((m) => g.mounts[m]).filter(Boolean);
      const mx0 = pts.length ? Math.min(...pts.map((q) => q.x)) : g.cx, mx1 = pts.length ? Math.max(...pts.map((q) => q.x)) : g.cx;
      const my0 = pts.length ? Math.min(...pts.map((q) => q.y)) : g.cy, my1 = pts.length ? Math.max(...pts.map((q) => q.y)) : g.cy;
      const ring = (rad: number) => { x.roundRect(mx0 - rad, my0 - rad, mx1 - mx0 + 2 * rad, my1 - my0 + 2 * rad, rad); };
      const ccx = (mx0 + mx1) / 2, ccy = (my0 + my1) / 2;
      x.save();
      x.globalAlpha = 0.12;
      x.fillStyle = o.color;
      x.beginPath(); ring(R);
      if (o.min) ring(o.min * P);
      x.fill('evenodd');
      x.globalAlpha = 0.95;
      x.strokeStyle = o.color;
      x.lineWidth = 2;
      x.beginPath(); ring(R); x.stroke();
      if (o.min) { x.setLineDash([5, 5]); x.beginPath(); ring(o.min * P); x.stroke(); x.setLineDash([]); }
      // a dot on each mount the ring is measured from
      x.fillStyle = o.color;
      for (const q of pts) { x.beginPath(); x.arc(q.x, q.y, 3, 0, Math.PI * 2); x.fill(); }
      // label on the ring, staggered so stacked rings don't collide
      const a = -Math.PI / 2 + (i % 2 ? 0.42 : -0.42) * Math.ceil(i / 2);
      const lx = ccx + Math.cos(a) * (R + (mx1 - mx0) / 2), ly = ccy + Math.sin(a) * (R + (my1 - my0) / 2);
      const txt = o.label;
      x.font = '700 14px "Barlow Condensed", system-ui, sans-serif';
      const tw = Math.min(260, x.measureText(txt).width) + 12;
      const bx = Math.max(6, Math.min(W - tw - 6, lx - tw / 2)), by = Math.max(6, Math.min(H - 28, ly - 11));
      x.fillStyle = 'rgba(5, 7, 9, 0.9)';
      x.fillRect(bx, by, tw, 22);
      x.fillStyle = o.color;
      x.fillRect(bx, by, 4, 22);
      x.fillStyle = '#f1ece0';
      x.textBaseline = 'middle';
      x.fillText(txt, bx + 9, by + 11.5, tw - 12);
      x.restore();
    });
    if (rangesOn && !rings.length) {
      x.font = '700 16px "Barlow Condensed", system-ui, sans-serif';
      x.fillStyle = 'rgba(241, 236, 224, 0.8)';
      x.textAlign = 'center';
      x.fillText('No ranged parts mounted', W / 2, 60);
      x.textAlign = 'left';
    }
    // scale bar (bottom-left): one cell
    const bx = 18, by = H - 20;
    x.fillStyle = 'rgba(8, 14, 20, 0.75)';
    x.fillRect(bx - 8, by - 20, P + 60, 30);
    x.strokeStyle = '#e8e2d0';
    x.lineWidth = 2;
    x.beginPath();
    x.moveTo(bx, by - 6); x.lineTo(bx, by); x.lineTo(bx + P, by); x.lineTo(bx + P, by - 6);
    x.stroke();
    x.fillStyle = '#e8e2d0';
    x.font = '700 13px "Barlow Condensed", system-ui, sans-serif';
    x.textBaseline = 'alphabetic';
    x.fillText(`${METERS_PER_CELL} m`, bx + P + 8, by + 1);
    x.font = '600 13px "Barlow Condensed", system-ui, sans-serif';
    x.fillStyle = 'rgba(232, 226, 208, 0.6)';
    x.fillText('1 CELL', bx, by - 9);
  }

  function dimLine(x: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, label: string, vertical: boolean) {
    x.beginPath();
    x.moveTo(x0, y0); x.lineTo(x1, y1);
    const t = 5;
    if (vertical) { x.moveTo(x0 - t, y0); x.lineTo(x0 + t, y0); x.moveTo(x1 - t, y1); x.lineTo(x1 + t, y1); }
    else { x.moveTo(x0, y0 - t); x.lineTo(x0, y0 + t); x.moveTo(x1, y1 - t); x.lineTo(x1, y1 + t); }
    x.stroke();
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const tw = x.measureText(label).width + 8;
    x.save();
    x.translate(mx, my);
    if (vertical) x.rotate(-Math.PI / 2);
    x.fillStyle = '#0a141c';
    x.fillRect(-tw / 2, -8, tw, 16);
    x.fillStyle = 'rgba(255, 196, 64, 0.95)';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(label, 0, 1);
    x.restore();
    x.textAlign = 'left';
  }

  // ---------------- animation ----------------
  function fit(c: HTMLCanvasElement): boolean {
    const r = c.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight) return false;
    return true; // drawUnitPreview sizes the backing store itself (one formula, no per-frame reallocation)
  }
  let frame = 0;
  let raf = 0;
  const tick = (now: number) => {
    if (destroyed) return;
    const t = now / 1000;
    try {
      if (fit(preview)) {
        const want = rangesOn ? rangeExtent() : MIN_VIEW_CELLS;
        viewExt += (want - viewExt) * (Math.abs(want - viewExt) < 0.01 ? 1 : 0.18);
        zoom += (zoomT - zoom) * (Math.abs(zoomT - zoom) < 0.002 ? 1 : 0.22);
        geom = drawUnitPreview(preview, draft, { side: 0, time: t, angle: -Math.PI / 2, minExtent: viewExt, still: true, zoom, pan });
        if (geom) { drawGrid(geom); placeSockets(); }
      }
      if (frame++ % 2 === 0) {
        for (const { c, get } of listCanvases) if (fit(c)) drawUnitPreview(c, get(), { side: 0, time: t, angle: -Math.PI / 2 });
      }
    } catch (err) {
      // a renderer hiccup must never kill the garage
      if (frame < 3) console.warn('preview render failed', err);
    }
    raf = requestAnimationFrame(tick);
  };

  const typing = () => {
    const a = document.activeElement as HTMLElement | null;
    if (document.querySelector('.k-pop')) return true; // a kit dropdown is open: its type-ahead owns the keys
    return !!a && (a.tagName === 'INPUT' || a.tagName === 'SELECT' || a.tagName === 'TEXTAREA' || a.getAttribute('role') === 'combobox');
  };
  const onKey = (e: KeyboardEvent) => {
    if (el.querySelector('.g-modal-back')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (dirty()) doSave();
      return;
    }
    if (e.key === 'Escape') {
      if (drag?.started) { cancelDrag(); return; }
      if (activeSlot !== null) { activeSlot = null; update(); }
      return;
    }
    if (typing() || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key.toLowerCase() === 'v') { toggleRanges(); return; }
    if (e.key === '+' || e.key === '=') { setZoom(zoomT * 1.4); return; }
    if (e.key === '-' || e.key === '_') { setZoom(zoomT / 1.4); return; }
    if (e.key === '0') { resetView(); return; }
    const tk = TABS.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
    if (tk) { setTab(tk.id); return; }
    const n = Number(e.key);
    if (n >= 1 && n <= chassis().mounts.length) { focusSlot(n - 1); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && activeSlot !== null && draft.mounts[activeSlot]) { e.preventDefault(); equip(activeSlot, null); }
  };
  const onUnload = (e: BeforeUnloadEvent) => { if (dirty()) e.preventDefault(); };
  // once a touch drag is live, stop the page from panning under the finger
  const onTouchMove = (e: TouchEvent) => { if (drag?.started) e.preventDefault(); };
  document.addEventListener('touchmove', onTouchMove, { passive: false });
  document.addEventListener('keydown', onKey);
  window.addEventListener('beforeunload', onUnload);

  nameInput.value = draft.name;
  update();
  raf = requestAnimationFrame(tick);

  return {
    el,
    destroy() {
      destroyed = true;
      cancelDrag();
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('beforeunload', onUnload);
    },
  };
};
