// Playground (sandbox): place any of your designs on BOTH halves of the field for free, press Fight, watch, edit,
// run again. No supply, rounds, commander HP or AI: only the per-side army caps the sim needs (MAX_BLOCKS /
// MAX_SIM_UNITS) and the usual placement rules (inside the deploy zone, no overlapping blocks).
// The sim runs directly here (new Battle(...) stepped per frame), drawn with the same BattleView as a match, and the
// field controls are the match screen's (fieldtools.ts): box / Shift / double-click group selection with group
// orders, escort orders, range rings, stat tooltips, the battle auto camera, right-drag turning the 3D view, clicking a unit
// mid-battle for its live stats, and the detailed stats screen after the battle.

import { createMinimap, type MiniDot } from './minimap.ts';
import { h, type App, type Screen } from '../app.ts';
import { playMusic, sfx } from '../audio.ts';
import { allDesigns } from '../collection.ts';
import type { BoardOverlay, BoardUnit } from '../render/field.ts';
import type { BattleView } from '../render/view.ts';
import { makeView } from '../render/viewfactory.ts';
import { MAPS } from '../render/ground.ts';
import { BATTLE_SPEEDS, applyViewSettings, loadSettings, speedLabel } from '../storage.ts';
import { Battle } from '../../shared/sim/battle.ts';
import { MAX_TICKS, TICK_RATE, type SimUnit } from '../../shared/sim/types.ts';
import {
  DEPLOY_D, DEPLOY_W, FIELD_H, MAX_SPACING, blockDims, blockInZone, blockWorldRect, blocksOverlap, hasSpacing, normSpacing,
  placementUnitCenters, type BlockShape,
} from '../../shared/grid.ts';
import { MAX_BLOCKS, MAX_SIM_UNITS } from '../../shared/match.ts';
import { CHASSIS_BY_ID, MOBILITY_BY_ID, MODULE_BY_ID } from '../../shared/parts.ts';
import { MAX_LEVEL, computeStats, defaultOrders, fmtUnitPrice } from '../../shared/stats.ts';
import type { Design, Placement, Side, UnitStats } from '../../shared/types.ts';
import * as kit from './kit.ts';
import { kiteOptions, miniStats, orderFields, ordersControl, ordersOf, paintPreview, sizeLabel, statCard, svgIcon, type EscortUi, type Orders } from './match-ui.ts';
import { spacingControl, worldToLocalRect } from './match.ts';
import { designInfo, type DesignInfo } from './deckstats.ts';
import { openRoundStats } from './roundstats.ts';
import {
  AutoCam, CARD_FILTERS, boxIsTiny, costTag, createRangeRings, drawBoxSel, inBox, liveLine, liveUnitAt, placeTipAt, ringLegend, stars,
  tipFor, zoomButtons, type BoxSel, type CardFilter, type RingTarget,
} from './fieldtools.ts';
import { secondaryLeft } from '../render/camera.ts';
import { createFpsMeter } from './fps.ts';

type Phase = 'edit' | 'battle' | 'result';
type PlaceSide = 'auto' | 0 | 1;
type Sel = { side: Side; uid: number } | null;
type OrdersPatch = Partial<Orders> & { escort?: number }; // escort -1 = clear

const KEY = 'ab2.playground';
const FILTER_KEY = 'ab2.playground.cardFilter';
const SIDE_NAME = ['Blue', 'Red'] as const;

interface Saved { v: 1; boards: [Placement[], Placement[]]; map?: string }

function randomSeed(): number {
  try { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0]; } catch { return (Math.random() * 2 ** 32) >>> 0; }
}

export function playgroundScreen(app: App): Screen {
  const settings = loadSettings();
  let speed = BATTLE_SPEEDS.includes(settings.battleSpeed) ? settings.battleSpeed : 1;

  // ---------- designs ----------
  const statCache = new Map<Design, UnitStats | null>();
  const statsOf = (d: Design): UnitStats | null => {
    if (!statCache.has(d)) { try { statCache.set(d, computeStats(d)); } catch { statCache.set(d, null); } }
    return statCache.get(d)!;
  };
  /** every buildable design in the garage, cheapest first */
  const designs = allDesigns().filter((d) => !!statsOf(d))
    .sort((a, b) => statsOf(a)!.cost - statsOf(b)!.cost || a.name.localeCompare(b.name));
  const byId = new Map(designs.map((d) => [d.id, d] as const));
  const shapeOf = (d: Design | undefined): BlockShape => (d && statsOf(d)) || { size: 1, squad: 1 };
  const squadOf = (d: Design | undefined) => (d ? statsOf(d)?.squad ?? 1 : 1);
  const defsOf = (id: string) => defaultOrders(byId.get(id));
  const newOrders = (d: Design) => {
    const defs = defaultOrders(d);
    const o = ordersOf(d.behavior, defs);
    return orderFields({ ...o, hold: hasSpacing(shapeOf(d)) && o.hold }, defs);
  };

  // ---------- layout state ----------
  let boards: [Placement[], Placement[]] = [[], []];
  let mapId = MAPS[0].id as string;
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Saved | null;
    if (s?.v === 1 && Array.isArray(s.boards)) {
      for (const sd of [0, 1] as Side[]) {
        const keep: Placement[] = [];
        let blocks = 0, units = 0;
        const list: unknown = s.boards[sd];
        for (const raw of Array.isArray(list) ? list as Placement[] : []) {
          const d = raw && typeof raw === 'object' ? byId.get(raw.designId) : undefined;
          if (!d || !Number.isInteger(raw.uid) || !Number.isInteger(raw.x) || !Number.isInteger(raw.y)) continue;
          if (keep.some((q) => q.uid === raw.uid)) continue;
          // a layout saved by an older build: stars and round within today's rules, unknown extras left to the sim
          const lv = Number.isInteger(raw.level) ? Math.max(1, Math.min(MAX_LEVEL, raw.level)) : 1;
          const p: Placement = { ...raw, level: lv, round: Number.isInteger(raw.round) ? raw.round : 1 };
          const shape = shapeOf(d);
          if (!blockInZone(p.x, p.y, shape, p.spacing, p.rot)) continue;
          // the army caps may have tightened since the layout was saved
          if (blocks + 1 > MAX_BLOCKS || units + shape.squad > MAX_SIM_UNITS) continue;
          if (keep.some((q) => blocksOverlap(p, shape, q, shapeOf(byId.get(q.designId))))) continue;
          keep.push(p);
          blocks++; units += shape.squad;
        }
        // an escort whose charge was dropped above escorts nobody
        boards[sd] = keep.map((p) => {
          if (p.escort == null || keep.some((q) => q.uid === p.escort && q.uid !== p.uid)) return p;
          const { escort: _e, ...r } = p;
          return r;
        });
      }
      if (s.map && MAPS.some((m) => m.id === s.map)) mapId = s.map;
    }
  } catch { /* no saved layout */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ v: 1, boards, map: mapId } satisfies Saved)); } catch { /* ignore */ } };
  let nextUid = 1 + Math.max(0, ...boards[0].map((p) => p.uid), ...boards[1].map((p) => p.uid));

  const undoStack: string[] = [];
  /** snapshot before a change (Undo restores it) */
  const snap = () => { undoStack.push(JSON.stringify(boards)); if (undoStack.length > 100) undoStack.shift(); };
  const changed = () => { save(); renderAll(); };

  let selCard = -1;
  let sel: Sel = null;
  /** box / shift-click / double-click group selection (2+ blocks); their battle orders are edited together */
  let multi: NonNullable<Sel>[] = [];
  const inMulti = (sd: Side, uid: number) => multi.some((x) => x.side === sd && x.uid === uid);
  /** the block whose escort target is being picked (click a friendly block) */
  let escortPick: NonNullable<Sel> | null = null;
  let placeSide: PlaceSide = 'auto';
  let newLevel = 1;
  let rotCard = false;
  const cardSpacing = new Map<string, number>();
  const spacingOfCard = (d: Design) => normSpacing(shapeOf(d), cardSpacing.get(d.id) ?? 0);
  let hover: { side: Side; x: number; y: number; shape: BlockShape; spacing: number; rot: boolean; valid: boolean; reason: string | null } | null = null;
  let hoverUnit: Sel = null; // block under the mouse (no card picked)
  let lastPtr: { px: number; py: number } | null = null;

  // ---------- battle state ----------
  let phase: Phase = 'edit';
  let battle: Battle | null = null;
  /** the layout the current battle was started from (live unit tips read spacing / rotation off it) */
  let fought: [Placement[], Placement[]] = [[], []];
  let runNo = 0;
  let seed = randomSeed();
  let acc = 0, endTimer = 0, paused = false;

  // ---------- rules ----------
  function capUse(sd: Side, skipUid = -1) {
    let units = 0, blocks = 0;
    for (const p of boards[sd]) if (p.uid !== skipUid) { blocks++; units += squadOf(byId.get(p.designId)); }
    return { blocks, units };
  }
  /** why block `p` (new, or moved/changed when its uid is already on the board) can't stand there; null = fine */
  function problem(sd: Side, p: Placement): string | null {
    const d = byId.get(p.designId);
    if (!d) return 'Unknown design';
    const shape = shapeOf(d);
    if (!blockInZone(p.x, p.y, shape, p.spacing, p.rot)) return 'Outside the deploy zone';
    const u = capUse(sd, p.uid);
    if (u.blocks + 1 > MAX_BLOCKS) return `Block cap reached (${MAX_BLOCKS} blocks per side)`;
    if (u.units + shape.squad > MAX_SIM_UNITS) return `Unit cap: ${u.units}/${MAX_SIM_UNITS} units on this side, ${d.name} adds ${shape.squad}`;
    for (const q of boards[sd]) if (q.uid !== p.uid && blocksOverlap(p, shape, q, shapeOf(byId.get(q.designId)))) return 'Overlaps another block';
    return null;
  }
  const find = (s: NonNullable<Sel>) => boards[s.side].find((p) => p.uid === s.uid);

  // ---------- DOM ----------
  const canvas = h('canvas');
  const ringCv = h('canvas.rings', { 'aria-hidden': 'true' });
  const boxEl = h('div.box-select.hidden', { 'aria-hidden': 'true' });
  const fieldwrap = h('div.fieldwrap', null, canvas, ringCv, boxEl);
  const view: BattleView = makeView(canvas, 0);
  const minimap = createMinimap(fieldwrap, view, canvas);
  /** minimap dots: live sim units in battle, placed blocks' units otherwise */
  const miniDots = (): MiniDot[] => battle
    ? battle.units.filter((u) => u.alive).map((u) => ({ x: u.x, y: u.y, side: u.side, size: u.stats.size, flying: u.flying }))
    : boardUnits().filter((b) => !b.ghost).map((b) => ({ x: b.x, y: b.y, side: b.side, size: 1.5, flying: false }));

  applyViewSettings(view);
  const applyMap = () => { try { view.setMap(MAPS.find((m) => m.id === mapId) ?? MAPS[0]); } catch { /* */ } };
  applyMap();

  const hpBlue = h('div.hp.me');
  const hpRed = h('div.hp.foe');
  const titleEl = h('div.round');
  const leaveBtn = h('button.icon.small', { title: 'Back to the main menu', onclick: () => { sfx('click'); app.go({ name: 'menu' }); } }, '‹', h('span.hide-sm', null, 'Menu'));
  const topbar = h('div.mbar', null, leaveBtn, hpBlue, titleEl, hpRed);

  const capEl = h('div.capmeter');
  const sideSel = h('div.pg-row');
  const levelSel = h('div.pg-row');
  const mapSel = h('div.pg-row');
  const cardsEl = h('div.cards');
  // card filter: what the card can do (as in the match shop; 1-9 follow the visible order)
  let cardFilter: CardFilter = 'all';
  try { const v = localStorage.getItem(FILTER_KEY); if (CARD_FILTERS.some((f) => f.value === v)) cardFilter = v as CardFilter; } catch { /* ignore */ }
  const infoCache = new Map<string, DesignInfo | null>();
  const infoOf = (d: Design) => { if (!infoCache.has(d.id)) infoCache.set(d.id, designInfo(d)); return infoCache.get(d.id)!; };
  /** design indices currently shown, in order (keys 1-9 pick from this) */
  let visibleCards: number[] = [];
  const filterEl = h('div.card-filter-wrap');
  // search by design name, hull, drive or any mounted module (all words must match)
  let query = '';
  const searchText = new Map<string, string>();
  const textOf = (d: Design) => {
    let t = searchText.get(d.id);
    if (t === undefined) {
      t = [d.name, CHASSIS_BY_ID.get(d.chassis)?.name, MOBILITY_BY_ID.get(d.mobility)?.name, ...d.mounts.map((m) => m && MODULE_BY_ID.get(m)?.name)]
        .filter(Boolean).join(' ').toLowerCase();
      searchText.set(d.id, t);
    }
    return t;
  };
  const matchesQuery = (d: Design) => !query || query.split(/\s+/).every((w) => textOf(d).includes(w));
  const searchInput = h('input.pg-search-in', {
    type: 'search', placeholder: 'Search units, hulls, weapons', 'aria-label': 'Search units',
    oninput: (e: Event) => { query = (e.target as HTMLInputElement).value.trim().toLowerCase(); renderCards(); },
    onkeydown: (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); const el = e.target as HTMLInputElement; if (el.value) { el.value = ''; query = ''; renderCards(); } else el.blur(); }
    },
  }) as HTMLInputElement;
  const searchEl = h('label.pg-search', null, svgIcon('search', 14), searchInput);
  function renderFilter() {
    filterEl.replaceChildren(kit.segmented<CardFilter>({
      value: cardFilter, label: 'Filter cards', className: 'card-filter',
      options: CARD_FILTERS.map((x) => {
        const n = designs.filter((d) => { const i = infoOf(d); return !!i && x.test(i); }).length;
        return { value: x.value, label: x.value === 'all' ? x.label : `${x.label} ${n}`, title: x.value === 'all' ? 'Every design in your garage' : x.title, disabled: x.value !== 'all' && n === 0 };
      }),
      onChange: (v) => {
        cardFilter = v; try { localStorage.setItem(FILTER_KEY, v); } catch { /* ignore */ }
        sfx('click'); renderFilter(); renderCards();
      },
    }));
  }
  const undoBtn = h('button.small', { title: 'Undo (Backspace / Ctrl+Z)', onclick: () => undo() }, 'Undo');
  const swapBtn = h('button.small', { title: 'Swap the two armies (each keeps its formation, seen from its own side)', onclick: () => swapSides() }, 'Swap sides');
  const clearBlueBtn = h('button.small', { title: 'Remove every Blue block', onclick: () => clearSide(0) }, 'Clear Blue');
  const clearRedBtn = h('button.small', { title: 'Remove every Red block', onclick: () => clearSide(1) }, 'Clear Red');
  const clearAllBtn = h('button.small.danger', { title: 'Remove every block on both sides', onclick: () => clearSide(-1) }, 'Clear all');
  const fightBtn = h('button.big.primary.deploy-btn', { title: 'Start the battle (Space / Enter)', onclick: () => fight() }, 'Fight!');
  const sideEl = h('div.side.pg-side', null,
    h('div.side-top', null, h('div.pg-head', null, h('b', null, 'Playground'), h('span.muted', null, 'Free placement on both sides')), capEl),
    h('div.pg-opts', null, sideSel, levelSel, mapSel),
    searchEl,
    filterEl,
    cardsEl,
    h('div.side-actions', null,
      h('div.row', null, undoBtn, swapBtn),
      h('div.row', null, clearBlueBtn, clearRedBtn, clearAllBtn),
      fightBtn),
  );

  const hintEl = h('div.hint');
  const miniEl = h('div.mini-wrap.hidden');
  // range overlay controls (Blue = the bottom side, drawn like "your" units in a match)
  let showBlue = false, showRed = false, shiftDown = false, ringHi: string | null = null;
  const blueBtn = h('button.small.rbtn', { type: 'button', title: 'Show weapon ranges of all Blue units (hold Shift)', 'aria-pressed': 'false', onclick: () => { showBlue = !showBlue; paintRangeBtns(); } }, svgIcon('range', 16), 'Blue ranges');
  const redBtn = h('button.small.rbtn.foe', { type: 'button', title: 'Show weapon ranges of all Red units', 'aria-pressed': 'false', onclick: () => { showRed = !showRed; paintRangeBtns(); } }, svgIcon('range', 16), 'Red ranges');
  const legendEl = ringLegend();
  // box-select mode: plain drag on the field draws a selection box (same as Shift+drag; the only way on touch)
  let boxMode = false;
  const selBtn = h('button.small.rbtn.sel', { type: 'button', title: 'Box select: drag a rectangle over blocks to set their orders together (or hold Shift and drag)', 'aria-pressed': 'false', onclick: () => { boxMode = !boxMode; selBtn.setAttribute('aria-pressed', String(boxMode)); selBtn.classList.toggle('active', boxMode); renderAll(); } }, svgIcon('select', 16), 'Box select');
  const rangeBar = h('div.rangebar', null, h('div.rbtns', null, blueBtn, redBtn, selBtn), legendEl);
  function paintRangeBtns() {
    blueBtn.classList.toggle('active', showBlue);
    blueBtn.setAttribute('aria-pressed', String(showBlue));
    redBtn.classList.toggle('active', showRed);
    redBtn.setAttribute('aria-pressed', String(showRed));
  }
  const infoEl = h('div.panel.info.hidden');
  const speedBtns = BATTLE_SPEEDS.map((v) => h('button.small', { title: `${speedLabel(v)} speed`, onclick: () => { speed = v; paused = false; renderSpeed(); } }, speedLabel(v)));
  const pauseBtn = h('button.small.pause-btn', { title: 'Pause / resume (Space or P)', 'aria-label': 'Pause', onclick: () => togglePause() }, '❚❚');
  function togglePause(on = !paused) { paused = on; renderSpeed(); }
  const skipBtn = h('button.small', { title: 'Skip to the end (Enter)', onclick: () => skipBattle() }, 'Skip ▸▸');
  const stopBtn = h('button.small', { title: 'Stop and go back to editing (Esc)', onclick: () => backToEdit() }, 'Edit');
  const speedbar = h('div.speedbar.hidden', null, stopBtn, pauseBtn, ...speedBtns, skipBtn);
  const zoomBar = zoomButtons(view);
  const overlayEl = h('div');
  fieldwrap.append(hintEl, miniEl, infoEl, speedbar, zoomBar, rangeBar, overlayEl);

  const el = h('div.screen.match.playground', null, topbar, h('div.mbody', null, fieldwrap, sideEl));
  // a button clicked with the mouse must not keep keyboard focus: Space / Enter would then re-press it instead of
  // fighting / pausing. Keyboard (Tab) focus keeps working as before.
  el.addEventListener('mousedown', (e) => {
    const b = (e.target as HTMLElement | null)?.closest('button');
    if (!b || b.getAttribute('role') === 'combobox') return;
    e.preventDefault();
    const a = document.activeElement;
    if (a instanceof HTMLElement && a !== b && el.contains(a) && a.tagName === 'BUTTON') a.blur();
  });

  // ---------- stat tooltips (floating near the cursor / card; bottom sheet on touch) ----------
  let tipEl: HTMLElement | null = null;
  let tipSize = { w: 0, h: 0 };
  let tipKey = '';
  let sheetOff: (() => void) | null = null;
  /** unit clicked during a battle: its stat card stays up with live hp / damage until you click elsewhere */
  let liveTip: { id: number } | null = null;
  let liveTipT = 0;
  const onRingHi = (k: string | null) => { ringHi = k; };
  function hideTip() { tipEl?.remove(); tipEl = null; tipKey = ''; sheetOff?.(); sheetOff = null; ringHi = null; liveTip = null; }
  function mountTip(tip: HTMLElement, sheet: boolean) {
    hideTip();
    tipEl = tip;
    if (sheet) {
      tip.classList.add('sheet');
      tip.prepend(h('button.icon.small.ghost.close', { type: 'button', 'aria-label': 'Close', onclick: () => hideTip() }, '✕'));
      const off = (e: Event) => { if (!tip.contains(e.target as Node)) hideTip(); };
      const t = window.setTimeout(() => document.addEventListener('pointerdown', off, true), 350);
      sheetOff = () => { clearTimeout(t); document.removeEventListener('pointerdown', off, true); };
    }
    el.append(tip);
    tipSize = { w: tip.offsetWidth, h: tip.offsetHeight };
  }
  function showCardTip(b: HTMLElement, d: Design, sheet: boolean) {
    const st = statsOf(d);
    if (!st) return;
    mountTip(tipFor(d, st, newLevel, 'Free here', true, spacingOfCard(d), sheet ? onRingHi : undefined, null, rotCard), sheet);
    if (sheet) return;
    const r = b.getBoundingClientRect(), er = el.getBoundingClientRect();
    const { w, h: ht } = tipSize;
    let left = r.left - er.left - w - 10;
    let top = Math.max(4, Math.min(er.height - ht - 4, r.top - er.top + r.height / 2 - ht / 2));
    if (left < 4) { // no room beside the card (narrow layouts): centre above it
      left = Math.max(4, Math.min(er.width - w - 4, r.left - er.left + r.width / 2 - w / 2));
      top = r.top - er.top - ht - 6;
      if (top < 4) top = r.bottom - er.top + 6;
    }
    tipEl!.style.left = `${left}px`;
    tipEl!.style.top = `${top}px`;
  }
  function attachCardTip(b: HTMLElement, d: Design) {
    let timer = 0;
    b.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') showCardTip(b, d, false); });
    b.addEventListener('pointerleave', (e) => { clearTimeout(timer); if (e.pointerType === 'mouse') hideTip(); });
    b.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      clearTimeout(timer);
      timer = window.setTimeout(() => { showCardTip(b, d, true); b.dataset.lp = '1'; }, 450);
    });
    const cancel = () => { clearTimeout(timer); if (b.dataset.lp) setTimeout(() => delete b.dataset.lp, 400); };
    b.addEventListener('pointerup', cancel);
    b.addEventListener('pointercancel', cancel);
    b.addEventListener('contextmenu', (e) => { if (b.dataset.lp) e.preventDefault(); });
    // a long-press should inspect, not select
    b.addEventListener('click', (e) => { if (b.dataset.lp) { e.stopImmediatePropagation(); delete b.dataset.lp; } }, true);
  }
  const blockParts = (d: Design) => h('div.parts', null, [CHASSIS_BY_ID.get(d.chassis)?.name, MOBILITY_BY_ID.get(d.mobility)?.name].filter(Boolean).join(' · '));
  /** header shared by the hover card and the pinned panel of a block on the field: portrait, name, level, side */
  function blockHead(s: NonNullable<Sel>, p: Placement, d: Design, st: UnitStats, prev: HTMLCanvasElement): HTMLElement {
    return h('div.head', null, prev, h('div', null,
      h('h3', { class: s.side === 0 ? 'friendly' : 'enemy' }, d.name),
      h('div.stars', null, stars(p.level)),
      h('div.sc-sub', null, `${SIDE_NAME[s.side]} side · `, costTag(st, d, p.level)),
    ));
  }
  /** (re)build the tooltip of a block on the field; `at` = client coords of the pointer (none: touch bottom sheet) */
  function showUnitTip(t: NonNullable<Sel>, at: { x: number; y: number } | null) {
    const p = find(t);
    const d = p && byId.get(p.designId);
    const st = d && statsOf(d);
    if (!p || !d || !st) { hideTip(); return; }
    const key = `${t.side}:${t.uid}:${p.level}:${p.spacing ?? 0}:${p.rot ? 1 : 0}`;
    const sheet = !at;
    if (key !== tipKey || !tipEl) {
      const prev = h('canvas');
      mountTip(h('div.stat-tip.unit-card', { role: 'tooltip', class: t.side === 0 ? 'friendly' : 'enemy' },
        blockHead(t, p, d, st, prev),
        statCard({ design: d, st, level: p.level, spacing: normSpacing(st, p.spacing), rot: !!p.rot, onRing: sheet ? onRingHi : undefined }),
        blockParts(d)), sheet);
      requestAnimationFrame(() => paintPreview(prev, d, t.side));
      tipKey = key;
    }
    if (sheet || !at) return;
    placeTipAt(tipEl!, el, at, tipSize);
  }
  function showLiveTip(u: SimUnit, at: { x: number; y: number }) {
    const bp = fought[u.side].find((q) => q.uid === u.uid); // the block's placement: real spacing / rotation
    const tip = tipFor(u.design, u.stats, u.level, SIDE_NAME[u.side], u.side === 0, normSpacing(u.stats, bp?.spacing), undefined, liveLine(battle, u), !!bp?.rot);
    mountTip(tip, false);
    tipKey = `live:${u.id}`;
    liveTip = { id: u.id };
    placeTipAt(tipEl!, el, at, tipSize);
  }
  function refreshLiveTip(dt: number) {
    if (!liveTip || !tipEl || !battle) return;
    liveTipT += dt;
    if (liveTipT < 0.2) return;
    liveTipT = 0;
    const u = battle.units.find((q) => q.id === liveTip!.id);
    const old = tipEl.querySelector('.sc-live');
    if (u && old) old.replaceWith(liveLine(battle, u));
  }

  // ---------- cards ----------
  const cardEls: HTMLButtonElement[] = designs.map((d, i) => {
    const st = statsOf(d)!;
    const inf = infoOf(d);
    const b = h('button.card', { onclick: () => selectCard(i) },
      h('canvas'),
      h('span.key'),
      h('span.count'),
      st.squad > 1 ? h('span.card-squad', { title: `One block is a squad of ${st.squad} units` }, `×${st.squad}`) : null,
      h('div.name', null, d.name),
      inf ? h('div.card-roles', null,
        inf.gnd > 0 ? h('span.db-chip.gnd', { title: 'Hits ground units' }, 'GND') : null,
        inf.air > 0 ? h('span.db-chip.air', { title: 'Hits aircraft' }, 'AIR') : null) : null,
      h('div.meta', null,
        h('span.cost', { title: st.squad > 1 ? `Match price: ${st.squad} units (≈${fmtUnitPrice(st.unitCost)} each). Free here.` : 'Match price (free here)' }, String(st.cost)),
        st.squad > 1 ? h('span.squad-badge', { title: `Squad of ${st.squad}` }, `×${st.squad}`) : null,
        h('span', null, `${sizeLabel(st.size)}${st.flying ? ' · Air' : ''}`)),
    );
    attachCardTip(b, d);
    return b;
  });
  cardsEl.replaceChildren(...cardEls);
  if (!designs.length) cardsEl.append(h('p.muted', { style: { gridColumn: '1 / -1' } }, 'No valid designs. Build some in the Garage first.'));
  const paintCards = () => requestAnimationFrame(() => cardEls.forEach((b, i) => paintPreview(b.querySelector('canvas')!, designs[i], 0)));

  function selectCard(i: number) {
    if (phase !== 'edit' || !designs[i]) return;
    selCard = selCard === i ? -1 : i;
    sel = null;
    multi = [];
    escortPick = null;
    hover = selCard >= 0 && lastPtr ? computeHover(lastPtr.px, lastPtr.py) : null;
    sfx('click');
    renderAll();
  }

  // ---------- rendering ----------
  function sideTotals(sd: Side): { alive: number; total: number; hp: number; maxHp: number } {
    let alive = 0, total = 0, hp = 0, maxHp = 0;
    if (battle) {
      for (const u of battle.units) if (u.side === sd) { total++; maxHp += u.maxHp; if (u.alive) { alive++; hp += Math.max(0, u.hp); } }
    }
    return { alive, total, hp, maxHp };
  }
  function renderTop() {
    titleEl.replaceChildren(document.createTextNode('Playground'), h('small', null, phase === 'edit' ? 'Edit' : phase === 'battle' ? 'Battle' : 'Result'));
    const bar = (sd: Side) => {
      if (phase === 'edit' || !battle) {
        const u = capUse(sd);
        return [h('div.who', null, h('span', null, SIDE_NAME[sd]), h('span', null, `${u.units} unit${u.units === 1 ? '' : 's'}`)), h('div.bar', null, h('i', { style: { width: `${(100 * u.units) / MAX_SIM_UNITS}%` } }))];
      }
      const t = sideTotals(sd);
      return [h('div.who', null, h('span', null, SIDE_NAME[sd]), h('span', null, `${t.alive}/${t.total}`)), h('div.bar', null, h('i', { style: { width: `${t.maxHp ? (100 * t.hp) / t.maxHp : 0}%` } }))];
    };
    hpBlue.replaceChildren(...bar(0));
    hpRed.replaceChildren(...bar(1));
  }
  function renderCaps() {
    const row = (sd: Side) => {
      const u = capUse(sd);
      const f = Math.max(u.units / MAX_SIM_UNITS, u.blocks / MAX_BLOCKS);
      return h('div.cap-row', { class: f >= 1 ? 'full' : f >= 0.8 ? 'warn' : '', title: `${SIDE_NAME[sd]}: ${u.blocks}/${MAX_BLOCKS} blocks, ${u.units}/${MAX_SIM_UNITS} units` },
        h('span', { class: sd === 0 ? 'friendly' : 'enemy' }, SIDE_NAME[sd]),
        h('div.cap-bar', null, h('i', { style: { width: `${Math.min(100, 100 * f)}%` } })),
        h('b', null, `${u.units}/${MAX_SIM_UNITS}`));
    };
    capEl.replaceChildren(row(0), row(1));
  }
  function renderOpts() {
    sideSel.replaceChildren(h('span.pg-lbl', null, 'Place on'), kit.segmented<string>({
      value: String(placeSide), label: 'Place on side', className: 'pg-seg',
      options: [
        { value: 'auto', label: 'Auto', title: 'The half of the field under the pointer (T cycles)' },
        { value: '0', label: 'Blue', title: 'Your side (bottom)' },
        { value: '1', label: 'Red', title: 'Enemy side (top)' },
      ],
      onChange: (v) => { placeSide = v === 'auto' ? 'auto' : (Number(v) as Side); sfx('click'); if (lastPtr) hover = computeHover(lastPtr.px, lastPtr.py); renderAll(); },
    }));
    levelSel.replaceChildren(h('span.pg-lbl', null, 'Level'), kit.segmented<number>({
      value: newLevel, label: 'Level of new blocks', className: 'pg-seg',
      options: Array.from({ length: MAX_LEVEL }, (_, i) => ({ value: i + 1, label: '★'.repeat(i + 1), title: `New blocks start at level ${i + 1}` })),
      onChange: (v) => { newLevel = v; sfx('click'); renderAll(); },
    }));
    mapSel.replaceChildren(h('span.pg-lbl', null, 'Map'), kit.select<string>({
      value: mapId, label: 'Map', className: 'pg-map',
      options: MAPS.map((m) => ({ value: m.id, label: m.name, hint: m.blurb })),
      onChange: (v) => { mapId = v; applyMap(); save(); },
    }));
  }
  function renderCards() {
    const edit = phase === 'edit';
    const flt = CARD_FILTERS.find((x) => x.value === cardFilter) ?? CARD_FILTERS[0];
    visibleCards = [];
    designs.forEach((d, i) => {
      const inf = infoOf(d);
      // the selected card stays visible even if the filter would hide it
      const show = i === selCard || ((inf ? flt.test(inf) : cardFilter === 'all') && matchesQuery(d));
      cardEls[i].hidden = !show;
      if (show) visibleCards.push(i);
    });
    cardEls.forEach((b, i) => {
      const d = designs[i];
      const k = visibleCards.indexOf(i);
      (b.querySelector('.key') as HTMLElement).textContent = k >= 0 && k < 9 ? String(k + 1) : '';
      b.classList.toggle('sel', i === selCard);
      b.disabled = !edit;
      const n = boards[0].filter((p) => p.designId === d.id).length + boards[1].filter((p) => p.designId === d.id).length;
      (b.querySelector('.count') as HTMLElement).textContent = n ? String(n) : '';
    });
    const empty = !boards[0].length && !boards[1].length;
    undoBtn.disabled = !edit || !undoStack.length;
    swapBtn.disabled = !edit || empty;
    clearBlueBtn.disabled = !edit || !boards[0].length;
    clearRedBtn.disabled = !edit || !boards[1].length;
    clearAllBtn.disabled = !edit || empty;
    fightBtn.disabled = !edit;
  }
  function renderHint() {
    let t = '';
    if (phase === 'edit' && escortPick) t = 'Click a friendly block to escort · Esc to cancel';
    else if (phase === 'edit') {
      const d = designs[selCard];
      if (d) t = hover && !hover.valid && hover.reason ? hover.reason
        : `Place ${d.name}${squadOf(d) > 1 ? ' squad' : ''} on ${placeSide === 'auto' ? 'either side' : SIDE_NAME[placeSide]}${hasSpacing(shapeOf(d)) ? ' · [ ] spacing · R rotate' : ''} · T side · Esc to cancel`;
      else if (multi.length >= 2) t = `${multi.length} blocks selected · Shift+click to add/remove · Del removes them · Esc to clear`;
      else if (boards[0].length || boards[1].length) {
        t = boxMode ? 'Drag a box over blocks to select them together · turn off Box select to pan'
          : window.matchMedia('(hover: none)').matches ? 'Tap a block to adjust it · Box select picks several to set their orders together'
            : `Click a block to adjust it · drag a box over several, or double-click to pick every one of a kind · right-drag (or Ctrl / Option + drag) to ${view.canRotate ? 'turn the view · WASD / middle-drag to pan' : 'pan'}`;
      } else t = 'Pick a unit card, then click either half of the field';
    } else if (phase === 'battle') t = 'Battle in progress';
    hintEl.textContent = t;
    hintEl.classList.toggle('hidden', !t);
    const cd = phase === 'edit' && !sel && !escortPick ? designs[selCard] : undefined;
    const cst = cd && statsOf(cd);
    if (cd && cst) miniEl.replaceChildren(miniStats(cd, cst, newLevel)); else miniEl.replaceChildren();
    miniEl.classList.toggle('hidden', !cst);
  }
  function renderSpeed() {
    if (phase !== 'battle') paused = false;
    speedBtns.forEach((b, i) => b.classList.toggle('active', !paused && BATTLE_SPEEDS[i] === speed));
    pauseBtn.classList.toggle('active', paused);
    fieldwrap.classList.toggle('paused', paused);
    pauseBtn.textContent = paused ? '▶' : '❚❚';
    pauseBtn.setAttribute('aria-label', paused ? 'Resume' : 'Pause');
    speedbar.classList.toggle('hidden', phase !== 'battle');
    rangeBar.classList.toggle('hidden', phase !== 'edit');
    renderHint();
  }

  // ---------- orders ----------
  /** change one block's orders in place (no undo snapshot, no redraw); `escort` -1 clears it */
  function applyOrders(s: NonNullable<Sel>, patch: OrdersPatch): boolean {
    const i = boards[s.side].findIndex((p) => p.uid === s.uid);
    if (i < 0) return false;
    const p = boards[s.side][i];
    const defs = defsOf(p.designId);
    const { escort: escPatch, ...op } = patch;
    const next: Orders = { ...ordersOf(p, defs), ...op };
    const esc = escPatch === undefined ? p.escort ?? -1 : escPatch;
    const { target: _t, hold: _h, kite: _k, kiteMount: _km, focus: _f, stance: _s, delay: _d, retreat: _r, escort: _e, ...rest } = p;
    boards[s.side][i] = {
      ...rest,
      ...orderFields({ ...next, hold: next.hold && hasSpacing(shapeOf(byId.get(p.designId))) }, defs),
      ...(esc >= 0 && esc !== p.uid ? { escort: esc } : {}),
    };
    return true;
  }
  function setOrders(s: NonNullable<Sel>, patch: OrdersPatch) {
    if (!find(s)) return;
    snap();
    applyOrders(s, patch);
    sfx('click');
    changed();
  }
  /** the same order change for every block of the group selection (squad-only orders skip single units) */
  function setGroupOrders(patch: OrdersPatch) {
    snap();
    for (const sl of multi) {
      const p = find(sl);
      const squad = p ? squadOf(byId.get(p.designId)) > 1 : false;
      const { hold, ...rest } = patch;
      const pp: OrdersPatch = hold !== undefined && squad ? { ...rest, hold } : rest;
      if (Object.keys(pp).length) applyOrders(sl, pp);
    }
    sfx('click');
    changed();
  }
  function escortUi(s: NonNullable<Sel>): EscortUi {
    const e = find(s)?.escort;
    const tp = e != null && e >= 0 ? boards[s.side].find((x) => x.uid === e) : undefined;
    return {
      label: e != null && e >= 0 ? byId.get(tp?.designId ?? '')?.name ?? `#${e}` : null,
      picking: !!escortPick && escortPick.side === s.side && escortPick.uid === s.uid,
      onPick: () => { escortPick = escortPick && escortPick.side === s.side && escortPick.uid === s.uid ? null : s; renderAll(); },
      onClear: () => setOrders(s, { escort: -1 }),
    };
  }
  /** blocks escorting `uid` on side `sd` stop (it is gone) */
  function dropEscortsTo(sd: Side, uid: number) {
    boards[sd] = boards[sd].map((p) => { if (p.escort !== uid) return p; const { escort: _e, ...r } = p; return r; });
  }

  // ---------- selected block panel ----------
  /** apply a change to the selected block; reverts with a toast when it would not fit */
  function editBlock(s: NonNullable<Sel>, fn: (p: Placement) => Placement): boolean {
    const i = boards[s.side].findIndex((p) => p.uid === s.uid);
    if (i < 0) return false;
    const next = fn({ ...boards[s.side][i] });
    const err = problem(s.side, next);
    if (err) { sfx('invalid'); app.toast(err, 'error'); return false; }
    snap();
    boards[s.side][i] = next;
    sfx('click');
    changed();
    return true;
  }
  /** keep a resized/turned block inside the zone, centred where it was */
  function refit(p: Placement, oldW: number, oldH: number): Placement {
    const shape = shapeOf(byId.get(p.designId));
    const bd = blockDims(shape, p.spacing, p.rot);
    const cx = p.x + oldW / 2, cy = p.y + oldH / 2;
    p.x = Math.max(0, Math.min(DEPLOY_W - bd.w, Math.round(cx - bd.w / 2)));
    p.y = Math.max(0, Math.min(DEPLOY_D - bd.h, Math.round(cy - bd.h / 2)));
    return p;
  }
  function setSpacing(s: NonNullable<Sel>, v: number) {
    editBlock(s, (p) => {
      const shape = shapeOf(byId.get(p.designId));
      const old = blockDims(shape, p.spacing, p.rot);
      p.spacing = normSpacing(shape, v);
      cardSpacing.set(p.designId, p.spacing);
      return refit(p, old.w, old.h);
    });
  }
  function rotateSel(s: NonNullable<Sel>) {
    editBlock(s, (p) => {
      const old = blockDims(shapeOf(byId.get(p.designId)), p.spacing, p.rot);
      if (p.rot) delete p.rot; else p.rot = true;
      return refit(p, old.w, old.h);
    });
  }
  function removeBlocks(list: NonNullable<Sel>[]) {
    const real = list.filter((s) => !!find(s));
    if (!real.length) return;
    snap();
    for (const s of real) {
      boards[s.side] = boards[s.side].filter((p) => p.uid !== s.uid);
      dropEscortsTo(s.side, s.uid);
    }
    const gone = (x: NonNullable<Sel>) => real.some((s) => s.side === x.side && s.uid === x.uid);
    if (sel && gone(sel)) sel = null;
    multi = multi.filter((x) => !gone(x));
    if (escortPick && gone(escortPick)) escortPick = null;
    sfx('click');
    changed();
  }
  const removeBlock = (s: NonNullable<Sel>) => removeBlocks([s]);

  const narrow = () => window.matchMedia('(max-width: 760px), (hover: none)').matches;
  /** while placing (card selected, nothing selected) the panel previews the card's stats; hidden on phones */
  function renderCardPreview(): boolean {
    const d = phase === 'edit' && !sel && !narrow() ? designs[selCard] : undefined;
    const st = d && statsOf(d);
    if (!d || !st) return false;
    const prev = h('canvas');
    infoEl.replaceChildren(
      h('button.icon.small.ghost.close', { onclick: () => { selCard = -1; hover = null; renderAll(); } }, '✕'),
      h('div.head', null, prev, h('div', null,
        h('h3', { class: hover?.side === 1 ? 'enemy' : 'friendly' }, d.name),
        h('div.sc-sub', null, 'Placing · ', costTag(st))),
      ),
      statCard({ design: d, st, level: newLevel, spacing: spacingOfCard(d), rot: rotCard, onRing: onRingHi }),
    );
    infoEl.classList.remove('hidden');
    infoEl.classList.remove('picking');
    requestAnimationFrame(() => paintPreview(prev, d, 0));
    return true;
  }
  function renderGroupInfo() {
    hideTip();
    const lead = multi[0];
    const lp = find(lead)!;
    const o = ordersOf(lp, defsOf(lp.designId));
    const ordersAt = (sl: NonNullable<Sel>) => { const p = find(sl); return p ? ordersOf(p, defsOf(p.designId)) : null; };
    const isSquad = (sl: NonNullable<Sel>) => { const p = find(sl); return !!p && squadOf(byId.get(p.designId)) > 1; };
    const anySquad = multi.some(isSquad);
    // orders the blocks disagree on show as mixed (Keep spread: among the squads only, single units have none)
    const mixed = new Set<keyof Orders>();
    for (const k of ['target', 'focus', 'stance', 'kite', 'hold', 'delay', 'retreat'] as const) {
      const vals = new Set(multi.filter((sl) => k !== 'hold' || isSquad(sl)).map((sl) => ordersAt(sl)?.[k]));
      if (vals.size > 1) mixed.add(k);
    }
    if (anySquad && !mixed.has('hold')) o.hold = ordersAt(multi.find(isSquad)!)?.hold !== false;
    const both = multi.some((x) => x.side === 0) && multi.some((x) => x.side === 1);
    const counts = new Map<string, number>();
    for (const sl of multi) {
      const p = find(sl);
      const n = `${both ? `${SIDE_NAME[sl.side]} ` : ''}${(p && byId.get(p.designId)?.name) ?? '?'}`;
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    const sideTag = both ? 'Blue and Red' : SIDE_NAME[lead.side];
    infoEl.replaceChildren(
      h('button.icon.small.ghost.close', { onclick: () => { multi = []; renderAll(); } }, '✕'),
      h('div.head', null, h('div', null,
        h('h3', { class: both || lead.side === 0 ? 'friendly' : 'enemy' }, `${multi.length} blocks selected`),
        h('div.sc-sub', null, `${sideTag} · `, [...counts].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join(' · ')),
      )),
      h('p.muted', { style: { margin: '4px 0 0', fontSize: '0.85rem' } }, mixed.size ? 'Order changes apply to every selected block (half-lit / Mixed: the blocks differ).' : 'Order changes apply to every selected block.'),
      h('div.info-spacing', null, ordersControl(o, anySquad, (patch) => setGroupOrders(patch), { custom: false, mixed })),
      h('div.actions', null, h('button.small.danger', { title: 'Remove every selected block (Del)', onclick: () => removeBlocks([...multi]) }, `Remove ${multi.length}`)),
    );
    infoEl.classList.remove('hidden');
    infoEl.classList.remove('picking');
  }
  function renderInfo() {
    multi = multi.filter((sl) => !!find(sl));
    if (multi.length >= 2 && phase === 'edit') { renderGroupInfo(); return; }
    multi = [];
    const s = phase === 'edit' ? sel : null;
    const p = s && find(s);
    const d = p && byId.get(p.designId);
    const st = d && statsOf(d);
    if (!s || !p || !d || !st) {
      if (s) sel = null;
      if (!renderCardPreview()) { infoEl.classList.add('hidden'); infoEl.replaceChildren(); }
      return;
    }
    hideTip();
    const prev = h('canvas');
    const squad = st.squad > 1;
    const defs = defsOf(p.designId);
    infoEl.replaceChildren(
      h('button.icon.small.ghost.close', { onclick: () => { sel = null; escortPick = null; renderAll(); } }, '✕'),
      blockHead(s, p, d, st, prev),
      h('div.info-spacing', null, h('div.sp-head', null, h('span', null, 'Level')), kit.segmented<number>({
        value: p.level, label: 'Block level', className: 'full', fk: 'pg-level',
        options: Array.from({ length: MAX_LEVEL }, (_, i) => ({ value: i + 1, label: '★'.repeat(i + 1) })),
        onChange: (v) => editBlock(s, (q) => ({ ...q, level: v })),
      })),
      statCard({ design: d, st, level: p.level, spacing: normSpacing(st, p.spacing), rot: !!p.rot, onRing: onRingHi }),
      h('div.info-spacing', null, ordersControl(ordersOf(p, defs), squad, (patch) => setOrders(s, patch), { escort: escortUi(s), kiteOptions: kiteOptions(d), defaults: defs, design: d })),
      squad ? h('div.info-spacing', null, spacingControl(normSpacing(st, p.spacing), (v) => setSpacing(s, v), shapeOf(d), !!p.rot)) : '',
      blockParts(d),
      h('div.actions', null,
        squad ? h('button.small', { title: 'Turn the formation 90° (R)', onclick: () => rotateSel(s) }, '⟳ Rotate') : null,
        h('button.small.danger', { title: 'Remove this block (Del, or click it again)', onclick: () => removeBlock(s) }, 'Remove')),
    );
    infoEl.classList.remove('hidden');
    infoEl.classList.toggle('picking', !!escortPick);
    requestAnimationFrame(() => paintPreview(prev, d, s.side));
  }

  // ---------- result banner ----------
  function renderOverlay() {
    overlayEl.replaceChildren();
    if (phase !== 'result' || !battle) return;
    const sum = battle.summary();
    const t0 = sideTotals(0), t1 = sideTotals(1);
    const w = sum.winner;
    const again = h('button.primary', { title: 'Same layout, new random seed (Enter)', onclick: () => fight() }, 'Run again');
    const statsBtn = battle.done ? h('button', { title: 'Every unit\'s combat record from this battle', onclick: () => { sfx('click'); showRoundStats(); } }, 'Detailed stats') : null;
    overlayEl.append(h('div.panel.banner', { class: w === 0 ? 'win' : w === 1 ? 'lose' : 'draw' },
      h('h4', null, `Playground · ${(sum.ticks / TICK_RATE).toFixed(1)} s`),
      h('h1', null, w === -1 ? 'Draw' : `${SIDE_NAME[w]} wins`),
      h('div.lines', null,
        h('span', null, 'Blue units left'), h('b', null, `${t0.alive} / ${t0.total}`),
        h('span', null, 'Red units left'), h('b', null, `${t1.alive} / ${t1.total}`),
        h('span', null, 'Blue damage dealt'), h('b', null, sum.damageDealt[0].toLocaleString()),
        h('span', null, 'Red damage dealt'), h('b', null, sum.damageDealt[1].toLocaleString()),
      ),
      h('div.actions', null,
        statsBtn,
        h('button', { title: 'Back to placing units (Esc)', onclick: () => backToEdit() }, 'Edit layout'),
        h('button', { title: 'Watch the exact same battle again', onclick: () => fight(seed) }, 'Replay'),
        again),
    ));
  }
  function showRoundStats() {
    if (!battle?.done || document.querySelector('.modal-back')) return;
    openRoundStats(battle, runNo, 0, [SIDE_NAME[0], SIDE_NAME[1]], 'Playground battle stats');
  }

  function renderAll() {
    // the info panel is rebuilt: keyboard focus on one of its controls moves to the control's replacement
    const ae = document.activeElement as HTMLElement | null;
    const fk = ae && infoEl.contains(ae) ? ae.getAttribute('data-fk') : null;
    renderTop();
    renderCaps();
    renderOpts();
    renderCards();
    renderInfo();
    renderSpeed();
    renderOverlay();
    if (fk && !infoEl.contains(document.activeElement)) {
      infoEl.querySelector<HTMLElement>(`[data-fk="${fk}"]`)?.focus({ preventScroll: true });
    }
  }

  // ---------- edit actions ----------
  function undo() {
    if (phase !== 'edit') return;
    const s = undoStack.pop();
    if (!s) return;
    boards = JSON.parse(s);
    if (sel && !find(sel)) sel = null;
    if (escortPick && !find(escortPick)) escortPick = null;
    sfx('click');
    changed();
  }
  function clearSide(sd: Side | -1) {
    if (phase !== 'edit') return;
    snap();
    if (sd !== 1) boards[0] = [];
    if (sd !== 0) boards[1] = [];
    sel = null;
    multi = [];
    escortPick = null;
    sfx('click');
    changed();
  }
  function swapSides() {
    if (phase !== 'edit') return;
    snap();
    boards = [boards[1], boards[0]];
    const flip = (x: NonNullable<Sel>) => ({ side: (1 - x.side) as Side, uid: x.uid });
    if (sel) sel = flip(sel);
    multi = multi.map(flip);
    if (escortPick) escortPick = flip(escortPick);
    sfx('click');
    changed();
  }

  function computeHover(px: number, py: number): typeof hover {
    const d = designs[selCard];
    if (!d) return null;
    let wp: { x: number; y: number };
    try { wp = view.screenToWorld(px, py); } catch { return null; }
    const sd: Side = placeSide === 'auto' ? (wp.y < FIELD_H / 2 ? 1 : 0) : placeSide;
    const shape = shapeOf(d);
    const spacing = spacingOfCard(d);
    const rot = rotCard && hasSpacing(shape);
    const { w: bw, h: bh } = blockDims(shape, spacing, rot);
    let { x, y } = worldToLocalRect(sd, Math.round(wp.x - bw / 2), Math.round(wp.y - bh / 2), bw, bh);
    if (y > DEPLOY_D + 2 || y < -bh - 1 || x < -bw - 1 || x > DEPLOY_W + 1) return null; // far from that zone
    x = Math.max(0, Math.min(DEPLOY_W - bw, x));
    y = Math.max(0, Math.min(DEPLOY_D - bh, y));
    const reason = problem(sd, candidate(d, x, y, spacing, rot));
    return { side: sd, x, y, shape, spacing, rot, valid: !reason, reason };
  }
  const candidate = (d: Design, x: number, y: number, spacing: number, rot: boolean): Placement => ({
    uid: nextUid, designId: d.id, x, y, level: newLevel, round: 1,
    ...(hasSpacing(shapeOf(d)) ? { spacing } : {}), ...(rot ? { rot: true } : {}), ...newOrders(d),
  });

  function placeAt(px: number, py: number) {
    hover = computeHover(px, py);
    const d = designs[selCard];
    if (!hover || !d) return;
    if (!hover.valid) { sfx('invalid'); if (hover.reason) app.toast(hover.reason, 'error'); return; }
    snap();
    boards[hover.side].push(candidate(d, hover.x, hover.y, hover.spacing, hover.rot));
    nextUid++;
    sfx('place');
    save();
    hover = computeHover(px, py);
    renderAll();
  }

  /** R: turn the squad about to be placed, else the selected squad, by 90° */
  function rotateBlock(): boolean {
    if (phase !== 'edit') return false;
    const d = designs[selCard];
    if (d) {
      if (!hasSpacing(shapeOf(d))) { app.toast('Only squads can be rotated'); return true; }
      rotCard = !rotCard;
      if (lastPtr) hover = computeHover(lastPtr.px, lastPtr.py);
      sfx('click');
      renderAll();
      return true;
    }
    const p = sel && find(sel);
    if (!sel || !p) return false;
    if (!hasSpacing(shapeOf(byId.get(p.designId)))) { app.toast('Only squads can be rotated'); return true; }
    rotateSel(sel);
    return true;
  }
  /** [ ] / Shift+wheel: step the spacing of the card being placed, else of the selected squad */
  function stepSpacing(dir: number): boolean {
    if (phase !== 'edit') return false;
    const d = designs[selCard];
    if (d && hasSpacing(shapeOf(d))) {
      cardSpacing.set(d.id, Math.max(0, Math.min(MAX_SPACING, spacingOfCard(d) + dir)));
      if (lastPtr) hover = computeHover(lastPtr.px, lastPtr.py);
      sfx('click'); renderAll(); return true;
    }
    const p = sel && find(sel);
    if (sel && p && hasSpacing(shapeOf(byId.get(p.designId)))) {
      const shape = shapeOf(byId.get(p.designId));
      const v = Math.max(0, Math.min(MAX_SPACING, normSpacing(shape, p.spacing) + dir));
      if (v !== normSpacing(shape, p.spacing)) setSpacing(sel, v);
      return true;
    }
    return false;
  }

  // ---------- field input ----------
  const local = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    // the ghost goes exactly where the finger / pointer is (an offset above the finger, to keep the ghost visible,
    // made touch placement land somewhere other than where you tapped)
    const y = e.clientY - r.top;
    return { px: e.clientX - r.left, py: y, rawY: y };
  };
  function blockAt(px: number, py: number): Sel {
    const at = (yy: number): Sel => {
      let w: { x: number; y: number };
      try { w = view.screenToWorld(px, yy); } catch { return null; }
      for (const sd of [0, 1] as Side[]) {
        for (const p of boards[sd]) {
          const r = blockWorldRect(sd, p, shapeOf(byId.get(p.designId)));
          if (w.x >= r.col && w.x <= r.col + r.w && w.y >= r.row && w.y <= r.row + r.h) return { side: sd, uid: p.uid };
        }
      }
      return null;
    };
    // tilted view: units stand off the ground, so a click on a hull's raised top also selects it
    return at(py) ?? (view.tilted ? at(py + 0.28 * view.cam.k) : null);
  }

  /** Shift / Box-select / mouse drag off a block: rubber-band selection of blocks (canvas CSS px) */
  let boxSel: BoxSel | null = null;
  const drawBox = () => drawBoxSel(boxEl, boxSel);
  /** blocks (either side) whose footprint centre falls inside the box */
  function blocksInBox(b: BoxSel): NonNullable<Sel>[] {
    const out: NonNullable<Sel>[] = [];
    for (const sd of [0, 1] as Side[]) {
      for (const p of boards[sd]) {
        const wr = blockWorldRect(sd, p, shapeOf(byId.get(p.designId)));
        let sp: { x: number; y: number };
        try { sp = view.worldToScreen(wr.col + wr.w / 2, wr.row + wr.h / 2); } catch { continue; }
        if (inBox(b, sp.x, sp.y)) out.push({ side: sd, uid: p.uid });
      }
    }
    return out;
  }
  /** every block of `id` on side `sd` */
  const blocksOfDesign = (sd: Side, id: string): NonNullable<Sel>[] => boards[sd].filter((p) => p.designId === id).map((p) => ({ side: sd, uid: p.uid }));
  // last plain click on a block, for double-click detection (the canvas dblclick event fires after the second click
  // already ran, and that click removes a selected block)
  let lastTap: { side: Side; uid: number; at: number } | null = null;
  /** make `list` the selection: one block = normal single selection, more = group */
  function selectBlocks(list: NonNullable<Sel>[]) {
    if (list.length === 1) { sel = list[0]; multi = []; } else { sel = null; multi = list; }
    if (list.length) sfx('click');
    renderAll();
  }

  let downAt: { x: number; y: number } | null = null;
  let lpTimer = 0;
  let lpDone = false;
  let moveDrag: { s: NonNullable<Sel>; offX: number; offY: number; ox: number; oy: number; started: boolean; reason: string | null; before: string } | null = null;

  canvas.addEventListener('pointerdown', (e) => {
    downAt = { x: e.clientX, y: e.clientY };
    lpDone = false;
    clearTimeout(lpTimer);
    moveDrag = null;
    // box select: Shift / Box-select mode always; with a mouse, any left-drag that starts off a block (blocks
    // drag-move). A click without dragging still selects normally (see pointerup). Right/middle-drag pans.
    if (phase === 'edit' && selCard < 0 && !escortPick && e.button === 0 && !secondaryLeft(e)
      && (e.shiftKey || boxMode || (e.pointerType === 'mouse' && !blockAt(local(e).px, local(e).rawY)))) {
      const { px, rawY } = local(e);
      boxSel = { x0: px, y0: rawY, x1: px, y1: rawY, add: e.shiftKey || boxMode };
      view.controls.enabled = false; // this gesture draws the selection box, not a camera pan
      try { canvas.setPointerCapture(e.pointerId); } catch { /* */ }
      return;
    }
    if (phase === 'edit' && selCard < 0 && !escortPick && e.button === 0 && !secondaryLeft(e)) {
      const { px, rawY } = local(e);
      const hit = blockAt(px, rawY);
      const p = hit && find(hit);
      if (hit && p) {
        let wp: { x: number; y: number } | null = null;
        try { wp = view.screenToWorld(px, rawY); } catch { /* */ }
        if (wp) {
          const r = blockWorldRect(hit.side, p, shapeOf(byId.get(p.designId)));
          moveDrag = { s: hit, offX: wp.x - r.col, offY: wp.y - r.row, ox: p.x, oy: p.y, started: false, reason: null, before: JSON.stringify(boards) };
          view.controls.enabled = false; // this gesture moves the block, not the camera
        }
      }
    }
    if (e.pointerType === 'touch' && phase === 'edit' && selCard < 0) {
      const { px, rawY } = local(e);
      lpTimer = window.setTimeout(() => { // long-press a block: peek at its stats without selecting it
        const hit = downAt && blockAt(px, rawY);
        if (hit) { lpDone = true; showUnitTip(hit, null); }
      }, 450);
    }
    try { canvas.setPointerCapture(e.pointerId); } catch { /* */ }
    if (phase === 'edit' && selCard >= 0) { const { px, py } = local(e); hover = computeHover(px, py); renderHint(); }
  });
  canvas.addEventListener('pointermove', (e) => {
    const lp = local(e);
    lastPtr = { px: lp.px, py: lp.py };
    if (boxSel) { boxSel.x1 = lp.px; boxSel.y1 = lp.rawY; drawBox(); return; }
    if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 8) clearTimeout(lpTimer);
    if (moveDrag && downAt) {
      if (!moveDrag.started && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) {
        moveDrag.started = true;
        hoverUnit = null;
        if (tipKey) hideTip();
        canvas.style.cursor = 'grabbing';
      }
      if (moveDrag.started) {
        const p = find(moveDrag.s);
        if (!p) return;
        const { w: bw, h: bh } = blockDims(shapeOf(byId.get(p.designId)), p.spacing, p.rot);
        let wp: { x: number; y: number };
        try { wp = view.screenToWorld(lp.px, lp.rawY); } catch { return; }
        let { x, y } = worldToLocalRect(moveDrag.s.side, Math.round(wp.x - moveDrag.offX), Math.round(wp.y - moveDrag.offY), bw, bh);
        x = Math.max(0, Math.min(DEPLOY_W - bw, x));
        y = Math.max(0, Math.min(DEPLOY_D - bh, y));
        p.x = x; p.y = y;
        moveDrag.reason = problem(moveDrag.s.side, p);
        hintEl.textContent = moveDrag.reason ?? 'Release to drop';
        hintEl.classList.remove('hidden');
        return;
      }
    }
    if (phase === 'edit' && selCard < 0 && e.pointerType === 'mouse' && !downAt) canvas.style.cursor = blockAt(lp.px, lp.rawY) ? 'grab' : '';
    if (phase === 'edit' && selCard < 0 && e.pointerType === 'mouse') {
      const hu = blockAt(lp.px, lp.rawY);
      hoverUnit = hu && !(sel && hu.side === sel.side && hu.uid === sel.uid) ? hu : null;
    } else hoverUnit = null;
    if (e.pointerType === 'mouse') {
      if (hoverUnit) showUnitTip(hoverUnit, { x: e.clientX, y: e.clientY });
      else if (tipKey && !liveTip) hideTip();
    }
    if (phase !== 'edit' || selCard < 0) return;
    if (e.pointerType === 'touch' && !downAt) return;
    const prev = hover;
    hover = computeHover(lp.px, lp.py);
    if (prev?.x !== hover?.x || prev?.y !== hover?.y || prev?.valid !== hover?.valid || prev?.side !== hover?.side) { renderHint(); if (prev?.side !== hover?.side) renderInfo(); }
  });
  canvas.addEventListener('pointerleave', (e) => {
    // a unit pinned mid-battle stays up when the pointer heads for the speed bar or the tip itself
    if (e.pointerType === 'mouse') { hover = null; hoverUnit = null; lastPtr = null; if (tipKey && !liveTip) hideTip(); renderHint(); }
  });
  /** finish (or abandon) a block move: invalid spots snap back */
  function endMove(commit: boolean): boolean {
    const md = moveDrag;
    moveDrag = null;
    view.controls.enabled = true;
    canvas.style.cursor = '';
    if (!md || !md.started) return false;
    const p = find(md.s);
    if (p && (!commit || md.reason)) {
      p.x = md.ox; p.y = md.oy;
      if (commit && md.reason) { sfx('invalid'); app.toast(md.reason, 'error'); }
    } else if (p && (p.x !== md.ox || p.y !== md.oy)) {
      undoStack.push(md.before);
      sfx('place');
      sel = md.s;
      multi = [];
      save();
    }
    renderAll();
    return true;
  }
  canvas.addEventListener('pointercancel', () => {
    downAt = null; hover = null; clearTimeout(lpTimer); endMove(false);
    if (boxSel) { boxSel = null; drawBox(); view.controls.enabled = true; }
  });
  canvas.addEventListener('pointerup', (e) => {
    const start = downAt;
    downAt = null;
    clearTimeout(lpTimer);
    if (boxSel) {
      const b = boxSel;
      boxSel = null;
      drawBox();
      view.controls.enabled = true;
      const tiny = boxIsTiny(b);
      if (tiny && !b.add) {
        // a plain click, not a drag: fall through to the normal click handling below
      } else if (tiny) {
        // shift-click: add / remove one block to the group
        const hit = blockAt(b.x0, b.y0);
        if (!hit) return;
        const cur = multi.length ? multi : sel ? [sel] : [];
        const has = cur.some((x) => x.side === hit.side && x.uid === hit.uid);
        selectBlocks(has ? cur.filter((x) => !(x.side === hit.side && x.uid === hit.uid)) : [...cur, hit]);
        return;
      } else {
        selectBlocks(blocksInBox(b));
        return;
      }
    }
    if (endMove(true)) return; // a drag-move, not a click
    if (lpDone) { lpDone = false; return; }
    if (!start || e.button > 0 || secondaryLeft(e)) return;
    if (view.wasDrag) { // end of a pan / pinch: not a click or tap
      if (e.pointerType === 'touch') { hover = null; renderHint(); }
      return;
    }
    if (phase === 'battle' || phase === 'result') {
      // battle: click a unit to pin its stats (live hp + damage), click empty ground to close
      const lp = local(e);
      const u = liveUnitAt(view, battle, lp.px, lp.rawY);
      if (u) { showLiveTip(u, { x: e.clientX, y: e.clientY }); sfx('click'); } else if (tipKey) hideTip();
      return;
    }
    const { px, py, rawY } = local(e);
    if (selCard >= 0) { placeAt(px, py); if (e.pointerType === 'touch') { hover = null; renderHint(); } return; }
    const hit = blockAt(px, rawY);
    if (escortPick) {
      const pk = escortPick;
      escortPick = null;
      if (hit && hit.side === pk.side && hit.uid !== pk.uid) setOrders(pk, { escort: hit.uid });
      else { sfx('invalid'); if (hit && hit.side !== pk.side) app.toast('Escort a block on the same side', 'error'); renderAll(); }
      return;
    }
    // double-click a block: select every block of that design on its side, to retune their orders together
    const now = performance.now();
    const dbl = !!hit && !!lastTap && lastTap.side === hit.side && lastTap.uid === hit.uid && now - lastTap.at < 400;
    lastTap = hit && !dbl ? { side: hit.side, uid: hit.uid, at: now } : null;
    if (dbl) {
      const id = find(hit!)?.designId;
      const all = id ? blocksOfDesign(hit!.side, id) : [];
      if (all.length > 1) { selectBlocks(all); app.toast(`Selected all ${all.length} ${SIDE_NAME[hit!.side]} ${byId.get(id!)?.name ?? ''} blocks`); return; }
    }
    // a second click on the selected block removes it (as a block placed this round in a match; Undo brings it back)
    if (hit && sel && sel.side === hit.side && sel.uid === hit.uid && !dbl && !multi.length) { removeBlock(hit); return; }
    multi = [];
    sel = hit;
    if (hit) sfx('click');
    renderAll();
  });
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (selCard >= 0) { selCard = -1; hover = null; renderAll(); }
  });

  // ---------- keyboard ----------
  const onKey = (e: KeyboardEvent) => {
    if (document.querySelector('.modal-back')) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    // kit dropdown open or focused: arrows / type-ahead / Space belong to it
    if (document.querySelector('.k-pop') || t?.getAttribute('role') === 'combobox') return;
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    if (plain && e.key >= '1' && e.key <= '9') {
      const i = visibleCards[Number(e.key) - 1];
      if (i !== undefined) selectCard(i);
      e.preventDefault();
    } else if (plain && e.key.toLowerCase() === 'r') {
      if (rotateBlock()) e.preventDefault();
    } else if (phase === 'edit' && plain && e.key.toLowerCase() === 't') {
      placeSide = placeSide === 'auto' ? 0 : placeSide === 0 ? 1 : 'auto';
      if (lastPtr) hover = computeHover(lastPtr.px, lastPtr.py);
      sfx('click'); renderAll(); e.preventDefault();
    } else if (plain && (e.key === '[' || e.key === ']')) {
      if (stepSpacing(e.key === ']' ? 1 : -1)) e.preventDefault();
    } else if (plain && (e.key === 'p' || e.key === 'P') && phase === 'battle') {
      e.preventDefault();
      togglePause();
    } else if (phase === 'edit' && (e.key === 'Delete' || (e.key === 'Backspace' && (sel || multi.length)))) {
      if (multi.length) { removeBlocks([...multi]); e.preventDefault(); } else if (sel) { removeBlock(sel); e.preventDefault(); }
    } else if (phase === 'edit' && (e.key === 'Backspace' || (e.key === 'z' && (e.ctrlKey || e.metaKey)))) {
      e.preventDefault();
      undo();
    // (F / Home = fit, + / - zoom, Q / E turn are the camera's own keys: CameraControls handles them)
    } else if (e.key === 'Escape') {
      if (tipEl?.classList.contains('sheet') || liveTip) { hideTip(); return; }
      if (phase !== 'edit') { backToEdit(); return; }
      if (escortPick) escortPick = null;
      else if (selCard >= 0) { selCard = -1; hover = null; }
      else { sel = null; multi = []; }
      renderAll();
    } else if (e.key === ' ' || e.key === 'Enter') {
      if (t && t.tagName === 'BUTTON') return; // let the focused button / kit control handle it
      e.preventDefault();
      if (phase === 'edit') fight();
      else if (phase === 'battle') { if (e.key === ' ') togglePause(); else skipBattle(); }
      else fight();
    }
  };
  document.addEventListener('keydown', onKey);
  const onShift = (e: KeyboardEvent) => { if (e.key === 'Shift') shiftDown = e.type === 'keydown'; };
  const onBlur = () => { shiftDown = false; };
  document.addEventListener('keydown', onShift);
  document.addEventListener('keyup', onShift);
  window.addEventListener('blur', onBlur);

  // Shift+wheel over the field changes squad spacing (captured here so the camera's wheel-zoom never sees it)
  let wheelAt = 0;
  const onWheel = (e: WheelEvent) => {
    if (!e.shiftKey || phase !== 'edit') return;
    const d = designs[selCard];
    const p = sel && find(sel);
    const can = (d && hasSpacing(shapeOf(d))) || (!d && p && hasSpacing(shapeOf(byId.get(p.designId))));
    if (!can) return;
    e.preventDefault();
    e.stopPropagation();
    const dy = e.deltaY || e.deltaX;
    const now = performance.now();
    if (!dy || now - wheelAt < 110) return;
    wheelAt = now;
    stepSpacing(dy < 0 ? 1 : -1);
  };
  fieldwrap.addEventListener('wheel', onWheel, { capture: true, passive: false });

  // ---------- battle ----------
  const autoCam = new AutoCam(view);
  function fight(withSeed?: number) {
    if (phase === 'battle') return;
    if (!boards[0].length || !boards[1].length) { sfx('invalid'); app.toast('Place at least one block on each side', 'error'); return; }
    seed = withSeed ?? randomSeed();
    try {
      fought = [structuredClone(boards[0]), structuredClone(boards[1])];
      battle = new Battle({ seed, sides: [{ designs, units: structuredClone(boards[0]) }, { designs, units: structuredClone(boards[1]) }] });
    } catch (e) {
      console.error('playground battle', e);
      app.toast('The battle could not start: ' + (e as Error).message, 'error');
      battle = null;
      return;
    }
    runNo++;
    acc = 0; endTimer = 0; paused = false;
    selCard = -1; sel = null; multi = []; escortPick = null; hover = null; hoverUnit = null;
    boxSel = null; drawBox();
    hideTip();
    phase = 'battle';
    rings.clear();
    sfx('ready');
    playMusic('battle');
    try { view.fit(); } catch { /* */ }
    autoCam.start(loadSettings().autoCam !== false);
    renderAll();
  }
  function skipBattle() {
    if (phase !== 'battle' || !battle) return;
    let n = 0;
    while (!battle.done && n++ < MAX_TICKS + 100) battle.step();
    showResult();
  }
  function showResult() {
    if (phase !== 'battle') return;
    phase = 'result';
    sfx(battle?.winner === -1 ? 'click' : 'roundWin');
    renderAll();
    if (loadSettings().roundStats !== false) showRoundStats();
  }
  function backToEdit() {
    if (phase === 'edit') return;
    phase = 'edit';
    battle = null;
    hideTip();
    sfx('click');
    playMusic('deploy');
    try { view.fit(); } catch { /* */ }
    renderAll();
  }

  // ---------- render loop ----------
  function boardUnits(): BoardUnit[] {
    const out: BoardUnit[] = [];
    for (const sd of [0, 1] as Side[]) {
      for (const p of boards[sd]) {
        const d = byId.get(p.designId);
        if (!d) continue;
        const selected = (!!sel && sel.side === sd && sel.uid === p.uid) || inMulti(sd, p.uid);
        const bad = !!moveDrag?.started && moveDrag.s.side === sd && moveDrag.s.uid === p.uid && !!moveDrag.reason;
        for (const c of placementUnitCenters(sd, p, shapeOf(d))) out.push({ side: sd, design: d, x: c.x, y: c.y, level: p.level, selected, ...(bad ? { ghost: true, invalid: true } : {}) });
      }
    }
    const d = designs[selCard];
    if (hover && d) {
      for (const c of placementUnitCenters(hover.side, hover, hover.shape)) out.push({ side: hover.side, design: d, x: c.x, y: c.y, level: newLevel, ghost: true, invalid: !hover.valid });
    }
    return out;
  }
  function outline(): BoardOverlay['hover'] {
    if (hover && selCard >= 0) {
      const r = blockWorldRect(hover.side, hover, hover.shape);
      return { col: r.col, row: r.row, size: Math.max(r.w, r.h), w: r.w, h: r.h, valid: hover.valid };
    }
    const t = sel ?? hoverUnit;
    const p = t && find(t);
    if (!t || !p) return null;
    const r = blockWorldRect(t.side, p, shapeOf(byId.get(p.designId)));
    return { col: r.col, row: r.row, size: Math.max(r.w, r.h), w: r.w, h: r.h, valid: !moveDrag?.reason };
  }

  // ---------- range rings overlay ----------
  const rings = createRangeRings(view, canvas, ringCv, legendEl, 0);
  function rangeTargets(): RingTarget[] {
    const out: RingTarget[] = [];
    if (phase !== 'edit') return out;
    const seen = new Set<string>();
    const push = (sd: Side, pos: RingTarget['pos'], d: Design | undefined, strong: boolean, key: string, invalid = false) => {
      if (!d || seen.has(key)) return;
      const st = statsOf(d);
      if (!st) return;
      seen.add(key);
      out.push({ side: sd, design: d, st, pos, strong, invalid });
    };
    if (hover && selCard >= 0) push(hover.side, { x: hover.x, y: hover.y, spacing: hover.spacing, rot: hover.rot }, designs[selCard], true, 'ghost', !hover.valid);
    for (const t of [sel, hoverUnit]) {
      const p = t && find(t);
      if (t && p) push(t.side, p, byId.get(p.designId), true, `${t.side}:${t.uid}`);
    }
    if (showBlue || shiftDown) for (const p of boards[0]) push(0, p, byId.get(p.designId), false, `0:${p.uid}`);
    if (showRed) for (const p of boards[1]) push(1, p, byId.get(p.designId), false, `1:${p.uid}`);
    return out;
  }
  /** keep the pinned stat panel from covering the block it describes (desktop: dock left or right) */
  function dockInfo() {
    if (infoEl.classList.contains('hidden') || narrow()) return;
    let cx: number | null = null;
    const p = sel && find(sel);
    if (sel && p) {
      const r = blockWorldRect(sel.side, p, shapeOf(byId.get(p.designId)));
      cx = view.worldToScreen(r.col + r.w / 2, r.row + r.h / 2).x;
    } else if (hover && selCard >= 0) {
      const r = blockWorldRect(hover.side, hover, hover.shape);
      cx = view.worldToScreen(r.col + r.w / 2, r.row + r.h / 2).x;
    }
    if (cx == null) return;
    const W = canvas.clientWidth;
    if (cx < 390) infoEl.classList.add('right');
    else if (cx > W - 450) infoEl.classList.remove('right');
  }

  let raf = 0;
  let last = performance.now();
  let drawErr = false;
  let topT = 0;
  const fps = createFpsMeter(fieldwrap);
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    fps.tick(now);
    view.controls.doubleClickZoom = phase !== 'edit' || (selCard < 0 && !sel);
    // right-drag (Ctrl / Option + drag), a two-finger twist and Q / E turn the 3D view while editing and watching, as in a match
    view.controls.rotate = !!view.canRotate;
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    try {
      if (phase !== 'edit' && battle) {
        if (phase === 'battle') {
          if (!paused) acc += dt * TICK_RATE * speed;
          let n = 0;
          while (acc >= 1 && !battle.done && n++ < 40) { battle.step(); acc -= 1; view.pushEvents(battle.events); }
          if (battle.done) { endTimer += dt; if (endTimer > 1.2) showResult(); }
          topT += dt;
          if (topT > 0.25) { topT = 0; renderTop(); }
        }
        rings.clear(); // first: a slow (3D) or throwing drawBattle must not leave edit rings up
        if (phase === 'battle') autoCam.update(battle, dt);
        view.drawBattle(battle, dt);
        refreshLiveTip(dt);
      } else {
        view.drawBoard(boardUnits(), { showZone: true, hover: outline() }, now / 1000);
        rings.draw(rangeTargets(), ringHi);
        dockInfo();
      }
      minimap.update(miniDots());
    } catch (e) {
      if (!drawErr) { drawErr = true; console.error('playground draw', e); }
    }
  };

  const ro = new ResizeObserver(() => { try { view.resize(); } catch { /* */ } });
  ro.observe(fieldwrap);
  let paintTimer = 0;
  const onResize = () => { clearTimeout(paintTimer); paintTimer = window.setTimeout(paintCards, 150); };
  window.addEventListener('resize', onResize);
  let gone = false;

  playMusic('deploy');
  renderFilter();
  renderAll();
  paintCards();
  raf = requestAnimationFrame(() => {
    if (gone) return;
    try { view.resize(); view.fit(true); } catch { /* */ }
    raf = requestAnimationFrame(frame);
  });

  return {
    el,
    destroy() {
      gone = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('keydown', onShift);
      document.removeEventListener('keyup', onShift);
      window.removeEventListener('blur', onBlur);
      fieldwrap.removeEventListener('wheel', onWheel, true);
      hideTip();
      try { view.destroy(); } catch { /* */ }
      minimap.destroy();
      fps.destroy();
    },
  };
}
