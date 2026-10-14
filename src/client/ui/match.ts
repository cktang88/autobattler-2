// Main gameplay screen: deploy phase (shop + placement on the field), waiting (pvp), battle replay,
// round result, game over. Works with any MatchDriver (LocalDriver for AI, NetDriver for PvP).

import { h, type App, type Route, type Screen } from '../app.ts';
import { playMusic, sfx } from '../audio.ts';
import { activeDeck } from '../collection.ts';
import type { MatchDriver } from '../driver.ts';
import { LocalDriver, lastWatched, setLastWatched } from '../localdriver.ts';
import { drawPartIcon, FieldView, type PartKind, type BoardOverlay, type BoardUnit } from '../render/field.ts';
import { applyViewSettings, loadSettings } from '../storage.ts';
import { Battle } from '../../shared/sim/battle.ts';
import { MAX_TICKS, TICK_RATE, type BattleEvent } from '../../shared/sim/types.ts';
import type { UnitFoot } from '../../shared/grid.ts';
import { DEPLOY_D, DEPLOY_W, FIELD_H, FIELD_W, MAX_SPACING, SQUAD_LAYOUT, blockDims, blockInZone, blockWorldRect, fmtMeters, fmtSpeed, hasSpacing, localToWorldCell, normSpacing, placementUnitCenters, squadOffsets } from '../../shared/grid.ts';
import { battleInputFor, START_HP, upgradeCost, validateDeploy } from '../../shared/match.ts';
import { CHASSIS_BY_ID, MOBILITY_BY_ID, MODULE_BY_ID } from '../../shared/parts.ts';
import { MAX_LEVEL, computeStats, levelMult } from '../../shared/stats.ts';
import { type DeployAction, type Design, type MatchState, type Placement, type RoundRecord, type Side, type Size, type UnitConfig, type UnitStats } from '../../shared/types.ts';
import * as kit from './kit.ts';
import { mapForRound } from '../render/ground.ts';
import { BATTLE_SPEEDS, speedLabel } from '../storage.ts';
import { RING_COLOR, confirmModal, kiteOptions, miniStats, ordersControl, ordersEqual, ordersOf, orderFields, paintPreview, ringsOf, sizeLabel, statCard, svgIcon, type EscortUi, type Orders } from './match-ui.ts';
import { playerName } from './vsai.ts';
import { designInfo, type DesignInfo } from './deckstats.ts';

type Phase = 'deploy' | 'waiting' | 'battle' | 'result' | 'over';

/** Inverse of localRectToWorld: top-left world cell of a w x h rectangle -> local deploy-grid coords for `side`. */
export function worldToLocalRect(side: Side, col: number, row: number, w: number, h: number): { x: number; y: number } {
  if (side === 0) return { x: col, y: row - (FIELD_H - DEPLOY_D) };
  return { x: FIELD_W - col - w, y: DEPLOY_D - row - h };
}

/** last spacing chosen per design id (kept across matches) */
const lastSpacing = new Map<string, number>();

/** Tiny diagram of a squad (8 x 2 units) at the given spacing, plus the footprint in metres. */
function spacingDiagram(spacing: number, foot?: UnitFoot): SVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const { w: cw, h: ch } = blockDims(1, spacing, foot);
  const px = Math.max(1.5, Math.min(4, 120 / cw));
  const svg = document.createElementNS(NS, 'svg');
  const W = cw * px, H = ch * px;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', String(Math.round(W * 0.9)));
  svg.setAttribute('height', String(Math.round(H * 0.9 + 4)));
  svg.setAttribute('class', 'sp-diagram');
  svg.setAttribute('aria-hidden', 'true');
  const r = document.createElementNS(NS, 'rect');
  r.setAttribute('x', '0.5'); r.setAttribute('y', '0.5'); r.setAttribute('width', String(W - 1)); r.setAttribute('height', String(H - 1));
  r.setAttribute('class', 'fp');
  svg.append(r);
  for (const o of squadOffsets(1, spacing, foot)) {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', String(o.x * px)); c.setAttribute('cy', String(o.y * px)); c.setAttribute('r', '1.4');
    svg.append(c);
  }
  return svg;
}

/** Segmented spacing control: "Spacing 0 1 2" + live diagram + footprint size. */
function spacingControl(value: number, onPick: ((v: number) => void) | null, foot?: UnitFoot): HTMLElement {
  const segs = kit.segmented({
    value, label: 'Squad spacing', disabled: !onPick,
    options: Array.from({ length: MAX_SPACING + 1 }, (_, v) => ({ value: v, label: String(v), title: `${v} empty ${v === 1 ? 'cell' : 'cells'} between units` })),
    onChange: (v) => onPick?.(v),
  });
  const d = blockDims(1, value, foot);
  return h('div.spacing', null,
    h('div.sp-head', null, h('span', null, 'Spacing'), h('span.muted', null, ...(onPick ? [h('kbd', null, '['), ' ', h('kbd', null, ']')] : ['locked']))),
    h('div.sp-row', null, spacingDiagram(value, foot), segs),
    h('div.sp-foot', null, `Footprint ${fmtMeters(d.w)} × ${fmtMeters(d.h)}`),
  );
}

type Op = { kind: 'place' | 'upgrade'; uid: number };
type Sel = { side: Side; uid: number; pending: boolean } | null;
type FieldWithEvents = FieldView & { pushEvents?: (events: BattleEvent[]) => void };

const stars = (lv: number) => '★'.repeat(lv) + '☆'.repeat(Math.max(0, MAX_LEVEL - lv));

export function matchScreen(app: App, route: Extract<Route, { name: 'match' }>): Screen {
  const driver: MatchDriver = route.driver;
  const side = driver.side;
  const opp = (1 - side) as Side;
  let m: MatchState = driver.state();
  const settings = loadSettings();
  let speed = BATTLE_SPEEDS.includes(settings.battleSpeed) ? settings.battleSpeed : 1;

  // ---------- design lookup ----------
  const statCache = new Map<Design, UnitStats | null>();
  const statsOf = (d: Design): UnitStats | null => {
    if (!statCache.has(d)) { try { statCache.set(d, computeStats(d)); } catch { statCache.set(d, null); } }
    return statCache.get(d)!;
  };
  const designOf = (s: Side, id: string): Design | undefined => m.players[s].deck.find((d) => d.id === id);
  const sizeOf = (d: Design | undefined): Size => (d ? statsOf(d)?.size ?? 1 : 1);
  const footOf = (d: Design | undefined): UnitFoot => { const st = d ? statsOf(d) : null; return st ? { fw: st.fw, fh: st.fh } : undefined; };
  const costOf = (d: Design | undefined): number => (d ? statsOf(d)?.cost ?? 0 : 0);
  const squadOf = (d: Design | undefined): number => (d ? statsOf(d)?.squad ?? 1 : 1);
  const spacingOfCard = (d: Design): number => normSpacing(sizeOf(d), lastSpacing.get(d.id) ?? 0);

  // ---------- deploy state ----------
  let pendingRound = -1;
  let place: Placement[] = [];
  let upgrades: number[] = [];
  let ops: Op[] = [];
  let nextUid = 1;
  let selCard = -1;
  let sel: Sel = null;
  let hover: { x: number; y: number; size: Size; spacing: number; rot?: boolean; w: number; h: number; valid: boolean; reason: string | null } | null = null;
  /** next squad is placed turned 90° (R while a card is selected) */
  let rotCard = false;
  const cfg = new Map<number, UnitConfig>(); // changed settings of units from earlier rounds
  let hoverUnit: Sel = null; // block under the mouse (nothing selected in the shop)
  let lastPtr: { px: number; py: number } | null = null;
  let submitting = false;

  // ---------- battle state ----------
  let phase: Phase = 'deploy';
  let battle: Battle | null = null;
  let replay: RoundRecord | null = null;
  /** damage each block dealt in the most recent resolved round, keyed "side:uid" */
  let lastDmg: { round: number; by: Map<string, number> } | null = null;
  /** read the per-block tally off a finished battle */
  function captureDamage(rec: RoundRecord, b: Battle) {
    const by = new Map<string, number>();
    for (const sd of [0, 1] as const) for (const p of rec.boards[sd]) by.set(`${sd}:${p.uid}`, Math.round(b.blockDamage(sd, p.uid)));
    lastDmg = { round: rec.round, by };
  }
  /** no replay watched this session (match resumed): quietly re-run the last round, the sim is deterministic */
  function ensureLastDamage() {
    const rec = m.history[m.history.length - 1];
    if (!rec || lastDmg?.round === rec.round) return;
    try {
      const b = new Battle(battleInputFor(m, rec));
      let n = 0;
      while (!b.done && n++ < MAX_TICKS + 100) b.step();
      captureDamage(rec, b);
    } catch (e) {
      console.warn('damage tally failed', e);
      lastDmg = { round: rec.round, by: new Map() }; // don't retry on every hover
    }
  }
  /** total damage a side's units dealt in the last tallied round */
  const sideDamage = (sd: Side) => { let t = 0; for (const [k, v] of lastDmg?.by ?? []) if (k.startsWith(`${sd}:`)) t += v; return t; };
  const damageLine = (sd: Side, uid: number): HTMLElement | null => {
    if (!lastDmg) return null;
    const v = lastDmg.by.get(`${sd}:${uid}`);
    if (v === undefined) return h('div.sc-dmg.none', null, 'New: no battle record yet');
    const ranked = [...lastDmg.by].filter(([k]) => k.startsWith(`${sd}:`)).map(([, x]) => x).sort((a, b) => b - a);
    const rank = ranked.indexOf(v) + 1;
    return h('div.sc-dmg', null,
      h('span', null, `Round ${lastDmg.round} damage`),
      h('b', null, v.toLocaleString()),
      v > 0 && ranked.length > 1 ? h('em', null, rank === 1 ? 'top of army' : `#${rank} of ${ranked.length}`) : null);
  };
  let acc = 0;
  let endTimer = 0;
  let destroyed = false;

  const me = () => m.players[side];
  const foe = () => m.players[opp];
  const deck = () => me().deck;
  const action = (): DeployAction => ({ round: m.round, place: place.map((p) => ({ ...p })), upgrade: [...upgrades], ...(cfg.size ? { configure: [...cfg.values()].map((c) => ({ ...c })) } : {}) });
  const check = (a: DeployAction): string | null => {
    try { return validateDeploy(m, side, a); } catch (e) { return (e as Error).message; }
  };

  const pendingUps = (uid: number) => upgrades.reduce((n, u) => n + (u === uid ? 1 : 0), 0);
  function spent(): number {
    let c = 0;
    for (const p of place) c += costOf(designOf(side, p.designId));
    const seen = new Map<number, number>();
    for (const uid of upgrades) {
      const u = me().board.find((b) => b.uid === uid);
      const d = u && designOf(side, u.designId);
      if (!u || !d) continue;
      const k = seen.get(uid) ?? 0;
      try { c += upgradeCost(d, u.level + k); } catch { /* ignore */ }
      seen.set(uid, k + 1);
    }
    return c;
  }
  const remaining = () => me().supply - spent();

  function resetPending() {
    pendingRound = m.round;
    place = [];
    upgrades = [];
    ops = [];
    cfg.clear();
    nextUid = me().nextUid;
    selCard = -1;
    sel = null;
    hover = null;
  }

  // ---------- DOM ----------
  const canvas = h('canvas');
  const ringCv = h('canvas.rings', { 'aria-hidden': 'true' });
  const fieldwrap = h('div.fieldwrap', null, canvas, ringCv);
  const view: FieldWithEvents = new FieldView(canvas, side);
  applyViewSettings(view);

  const roundEl = h('div.round');
  const hpMe = h('div.hp.me');
  const hpFoe = h('div.hp.foe');
  const leaveBtn = h('button.icon.small', { title: 'Leave match', onclick: () => leave() }, '‹', h('span.hide-sm', null, 'Leave'));
  const topbar = h('div.mbar', null, leaveBtn, hpMe, roundEl, hpFoe);

  const supplyVal = h('div.val');
  const supplyLbl = h('div.lbl', null, 'Supply', h('br'), 'remaining');
  const cardsEl = h('div.cards');
  // shop filter: what the card can do (sorted cheapest first; 1-9 follow the visible order)
  type CardFilter = 'all' | 'aa' | 'ground' | 'armor' | 'swarm' | 'long' | 'air';
  const CARD_FILTERS: { value: CardFilter; label: string; title: string; test: (i: DesignInfo) => boolean }[] = [
    { value: 'all', label: 'All', title: 'Every design in your deck', test: () => true },
    { value: 'aa', label: 'Anti-air', title: 'Can shoot aircraft', test: (i) => i.caps.has('aa') },
    { value: 'ground', label: 'Anti-ground', title: 'Can shoot ground units', test: (i) => i.gnd > 0 },
    { value: 'armor', label: 'Anti-armor', title: 'Armor-piercing or heavy single hits', test: (i) => i.caps.has('armor') },
    { value: 'swarm', label: 'Splash', title: 'Splash, flame, chain or spread: clears light squads', test: (i) => i.caps.has('swarm') },
    { value: 'long', label: 'Long range', title: 'Reaches 80 m or more', test: (i) => i.caps.has('long') },
    { value: 'air', label: 'Aircraft', title: 'Flying units', test: (i) => i.caps.has('air') },
  ];
  let cardFilter: CardFilter = 'all';
  try { const v = localStorage.getItem('match.cardFilter'); if (CARD_FILTERS.some((f) => f.value === v)) cardFilter = v as CardFilter; } catch { /* ignore */ }
  const infoCache = new Map<string, DesignInfo | null>();
  const infoOf = (d: Design) => { if (!infoCache.has(d.id)) infoCache.set(d.id, designInfo(d)); return infoCache.get(d.id)!; };
  /** deck indices in display order: cheapest first, unbuildable designs last */
  const cardOrder = () => deck().map((_, i) => i).sort((a, b) => {
    const da = deck()[a], db = deck()[b];
    const ca = statsOf(da) ? costOf(da) : Infinity, cb = statsOf(db) ? costOf(db) : Infinity;
    return ca - cb || da.name.localeCompare(db.name);
  });
  /** deck indices currently shown, in order (keys 1-9 pick from this) */
  let visibleCards: number[] = [];
  const filterEl = h('div.card-filter-wrap');
  function renderFilter() {
    filterEl.replaceChildren(kit.segmented<CardFilter>({
      value: cardFilter, label: 'Filter cards', className: 'card-filter',
      options: CARD_FILTERS.map((x) => {
        const n = deck().filter((d) => { const i = infoOf(d); return !!i && x.test(i); }).length;
        return { value: x.value, label: x.value === 'all' ? x.label : `${x.label} ${n}`, title: x.title, disabled: x.value !== 'all' && n === 0 };
      }),
      onChange: (v) => {
        cardFilter = v; try { localStorage.setItem('match.cardFilter', v); } catch { /* ignore */ }
        sfx('click'); renderFilter(); renderCards();
      },
    }));
  }
  const undoBtn = h('button.small', { onclick: () => undo(), title: 'Undo (Backspace)' }, 'Undo');
  const clearBtn = h('button.small', { onclick: () => clearAll(), title: 'Clear all pending' }, 'Clear');
  const deployBtn = h('button.big.primary.deploy-btn', { onclick: () => submit() }, 'Deploy & Fight');
  const shopSpacingEl = h('div.shop-spacing.hidden');
  const sideEl = h('div.side', null,
    h('div.side-top', null, h('div.supply', null, supplyVal, supplyLbl, h('div.spacer'), h('span.kbd-hint.muted', { style: { fontSize: '0.92rem' } }, h('kbd', null, '1-9'), ' select'))),
    filterEl,
    cardsEl,
    shopSpacingEl,
    h('div.side-actions', null, h('div.row', null, undoBtn, clearBtn), deployBtn),
  );

  const hintEl = h('div.hint');
  const miniEl = h('div.mini-wrap.hidden');
  // range overlay controls
  let showMine = false, showFoe = false, shiftDown = false, ringHi: string | null = null;
  const mineBtn = h('button.small.rbtn', { type: 'button', title: 'Show weapon ranges of all your units (hold Shift)', 'aria-pressed': 'false', onclick: () => { showMine = !showMine; paintRangeBtns(); } }, svgIcon('range', 16), 'Ranges');
  const foeBtn = h('button.small.rbtn.foe', { type: 'button', title: 'Show weapon ranges of all enemy units', 'aria-pressed': 'false', onclick: () => { showFoe = !showFoe; paintRangeBtns(); } }, svgIcon('range', 16), 'Enemy ranges');
  const legendEl = h('div.rlegend.hidden', null,
    h('span', { style: `--c:${RING_COLOR.ground}` }, 'Ground'),
    h('span', { style: `--c:${RING_COLOR.air}` }, 'Air'),
    h('span', { style: `--c:${RING_COLOR.both}` }, 'Both'),
    h('span.sup', { style: `--c:${RING_COLOR.support}` }, 'Support'),
    h('span.dash', { style: `--c:${'#ffffff'}` }, 'Min range'),
  );
  const rangeBar = h('div.rangebar.hidden', null, h('div.rbtns', null, mineBtn, foeBtn), legendEl);
  function paintRangeBtns() {
    mineBtn.classList.toggle('active', showMine);
    mineBtn.setAttribute('aria-pressed', String(showMine));
    foeBtn.classList.toggle('active', showFoe);
    foeBtn.setAttribute('aria-pressed', String(showFoe));
  }
  const infoEl = h('div.panel.info.hidden');
  const speedBtns = BATTLE_SPEEDS.map((v) => h('button.small', { title: `${speedLabel(v)} speed`, onclick: () => { speed = v; renderSpeed(); } }, speedLabel(v)));
  const skipBtn = h('button.small', { onclick: () => skipBattle() }, 'Skip ▸▸');
  const speedbar = h('div.speedbar.hidden', null, ...speedBtns, skipBtn);
  const overlayEl = h('div');
  const zoomBar = h('div.zoombtns', null,
    h('button.small', { title: 'Zoom in (+)', 'aria-label': 'Zoom in', onclick: () => view.zoomBy(1.5) }, '+'),
    h('button.small', { title: 'Zoom out (-)', 'aria-label': 'Zoom out', onclick: () => view.zoomBy(1 / 1.5) }, '−'),
    h('button.small', { title: 'Fit whole field (F)', 'aria-label': 'Fit whole field', onclick: () => view.fit() }, '⤢'),
  );
  fieldwrap.append(hintEl, miniEl, infoEl, speedbar, zoomBar, rangeBar, overlayEl);

  const el = h('div.screen.match', null, topbar, h('div.mbody', null, fieldwrap, sideEl));

  // ---------- card shop ----------
  let cardEls: HTMLButtonElement[] = [];
  function buildCards() {
    cardEls = deck().map((d, i) => {
      const st = statsOf(d);
      const c = h('canvas');
      const b = h('button.card', { onclick: () => selectCard(i) },
        c,
        h('span.key', null, String(i + 1)),
        h('span.count'),
        h('div.name', null, d.name),
        h('div.meta', null, h('span.cost', { title: st && st.squad > 1 ? `Block price: ${st.squad} units (${st.unitCost} each)` : 'Supply price' }, st ? String(st.cost) : '?'), st && st.squad > 1 ? h('span.squad-badge', { title: `Squad of ${st.squad}` }, `×${st.squad}`) : null, h('span', null, st ? `${sizeLabel(st.size)}${st.flying ? ' · Air' : ''}` : 'invalid')),
      );
      attachDeckTip(b, d);
      return b;
    });
    cardsEl.replaceChildren(...cardOrder().map((i) => cardEls[i]));
    infoCache.clear();
    renderFilter();
    paintCards();
  }
  // ---------- stat tooltip (floating near the cursor / shop card; bottom sheet on touch) ----------
  let tipEl: HTMLElement | null = null;
  let tipSize = { w: 0, h: 0 };
  let tipKey = '';
  let sheetOff: (() => void) | null = null;
  function hideTip() { tipEl?.remove(); tipEl = null; tipKey = ''; sheetOff?.(); sheetOff = null; ringHi = null; }
  function tipFor(d: Design, st: UnitStats, level: number, tag: string, mine: boolean, spacing: number, interactive: boolean, dmg: HTMLElement | null = null): HTMLElement {
    const lv = Math.max(1, Math.min(MAX_LEVEL, level));
    return h('div.stat-tip', { role: 'tooltip', class: mine ? 'friendly' : 'enemy' },
      h('div.sc-head', null,
        h('b.sc-name', null, d.name),
        h('span.stars', null, stars(lv)),
        h('span.sc-tag2', null, tag),
        h('span.sc-cost', null, svgIcon('cost', 16), String(st.cost))),
      dmg,
      statCard({ design: d, st, level: lv, spacing, onRing: interactive ? (k) => { ringHi = k; } : undefined }));
  }
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
  function showDeckTip(b: HTMLElement, d: Design, sheet: boolean) {
    const st = statsOf(d);
    if (!st) return;
    mountTip(tipFor(d, st, 1, 'In shop', true, spacingOfCard(d), sheet), sheet);
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
  /** (re)build the tooltip of a block on the field; `at` = client coords of the pointer */
  function showUnitTip(t: NonNullable<Sel>, at: { x: number; y: number } | null) {
    const p = blockSrc(t);
    const d = p && designOf(t.side, p.designId);
    const st = d && statsOf(d);
    if (!p || !d || !st) { hideTip(); return; }
    const mine = t.side === side;
    const lv = p.level + (mine && !t.pending ? pendingUps(p.uid) : 0);
    const key = `${t.side}:${t.uid}:${t.pending}:${lv}`;
    const sheet = !at; // no pointer position = touch long-press: bottom sheet
    if (key !== tipKey || !tipEl) {
      if (!t.pending) ensureLastDamage();
      mountTip(tipFor(d, st, lv, mine ? (t.pending ? 'Yours · new' : 'Yours') : 'Enemy', mine, normSpacing(st.size, p.spacing), sheet, t.pending ? null : damageLine(t.side, t.uid)), sheet);
      tipKey = key;
    }
    if (sheet || !at) return;
    const er = el.getBoundingClientRect();
    const { w, h: ht } = tipSize;
    let left = at.x - er.left + 18, top = at.y - er.top + 18;
    if (left + w > er.width - 4) left = at.x - er.left - w - 18;
    if (top + ht > er.height - 4) top = at.y - er.top - ht - 18;
    tipEl!.style.left = `${Math.max(4, left)}px`;
    tipEl!.style.top = `${Math.max(4, top)}px`;
  }
  function attachDeckTip(b: HTMLElement, d: Design) {
    let timer = 0;
    b.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') showDeckTip(b, d, false); });
    b.addEventListener('pointerleave', (e) => { clearTimeout(timer); if (e.pointerType === 'mouse') hideTip(); });
    b.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      clearTimeout(timer);
      timer = window.setTimeout(() => { showDeckTip(b, d, true); b.dataset.lp = '1'; }, 450);
    });
    const cancel = () => { clearTimeout(timer); if (b.dataset.lp) setTimeout(() => delete b.dataset.lp, 400); };
    b.addEventListener('pointerup', cancel);
    b.addEventListener('pointercancel', cancel);
    b.addEventListener('contextmenu', (e) => { if (b.dataset.lp) e.preventDefault(); });
    // a long-press should inspect, not select
    b.addEventListener('click', (e) => { if (b.dataset.lp) { e.stopImmediatePropagation(); delete b.dataset.lp; } }, true);
  }
  function paintCards() {
    requestAnimationFrame(() => {
      cardEls.forEach((b, i) => { const d = deck()[i]; if (d) paintPreview(b.querySelector('canvas')!, d, 0); }); // previews use absolute team colors: 0 = friendly
    });
  }
  function renderCards() {
    const rem = remaining();
    const deploying = phase === 'deploy';
    const flt = CARD_FILTERS.find((x) => x.value === cardFilter) ?? CARD_FILTERS[0];
    visibleCards = [];
    for (const i of cardOrder()) {
      const inf = infoOf(deck()[i]);
      // the selected card stays visible even if the filter would hide it
      const show = i === selCard || (inf ? flt.test(inf) : cardFilter === 'all');
      cardEls[i].hidden = !show;
      if (show) visibleCards.push(i);
    }
    cardEls.forEach((b, i) => {
      const d = deck()[i];
      const cost = costOf(d);
      const k = visibleCards.indexOf(i);
      (b.querySelector('.key') as HTMLElement).textContent = k >= 0 && k < 9 ? String(k + 1) : '';
      const n = place.filter((p) => p.designId === d.id).length;
      b.classList.toggle('sel', i === selCard);
      b.classList.toggle('poor', cost > rem);
      b.disabled = !deploying || cost > rem || !statsOf(d);
      (b.querySelector('.count') as HTMLElement).textContent = n ? `+${n}` : '';
    });
  }

  function selectCard(i: number) {
    if (phase !== 'deploy') return;
    const d = deck()[i];
    if (!d) return;
    if (selCard === i) { selCard = -1; hover = null; sfx('click'); renderAll(); return; }
    if (costOf(d) > remaining()) { sfx('invalid'); app.toast(`Not enough supply for ${d.name}`, 'error'); return; }
    selCard = i;
    sel = null;
    sfx('click');
    renderAll();
  }

  // ---------- top bar ----------
  function hpAt(s: Side, throughRound: number): number {
    let hp = m.players[s].hp;
    for (const r of m.history) if (r.round > throughRound) hp += r.result.damage[s];
    return hp;
  }
  function renderTop() {
    const shownRound = replay && (phase === 'battle' || phase === 'result') ? replay.round : m.round;
    const through = replay && phase === 'battle' ? replay.round - 1 : replay && phase === 'result' ? replay.round : Infinity;
    const myHp = Math.max(0, through === Infinity ? me().hp : hpAt(side, through));
    const foeHp = Math.max(0, through === Infinity ? foe().hp : hpAt(opp, through));
    const max = Math.max(1, START_HP, myHp, foeHp);
    const tag = phase === 'battle' ? 'Battle' : phase === 'result' ? 'Result' : phase === 'over' ? 'Final' : phase === 'waiting' ? 'Waiting' : 'Deploy';
    // maps rotate every round; the battle replay is fought on the map of the round it belongs to
    const map = mapForRound(shownRound);
    view.setMap?.(map);
    roundEl.replaceChildren(document.createTextNode(`Round ${shownRound}`), h('small', { title: map.blurb }, `${tag} · ${map.name}`));
    const showReady = driver.mode === 'pvp' && (phase === 'deploy' || phase === 'waiting');
    hpMe.replaceChildren(
      h('div.who', null, h('span', null, me().name || 'You'), h('span', null, String(myHp))),
      h('div.bar', null, h('i', { style: { width: `${(100 * myHp) / max}%` } })),
    );
    hpFoe.replaceChildren(
      h('div.who', null,
        h('span', null, foe().name || driver.opponentName() || 'Opponent',
          showReady ? h('span.ready-dot', { class: foe().ready ? 'on' : null, title: foe().ready ? 'Opponent is ready' : 'Opponent is deploying' }) : null),
        h('span', null, String(foeHp))),
      h('div.bar', null, h('i', { style: { width: `${(100 * foeHp) / max}%` } })),
    );
  }

  function renderSide() {
    const rem = remaining();
    // during a replay/result the state already holds next round's supply; don't show it until deploy
    const replaying = phase === 'battle' || phase === 'result';
    supplyVal.textContent = replaying ? '—' : String(rem);
    supplyVal.classList.toggle('low', !replaying && rem < 0);
    const deploying = phase === 'deploy';
    undoBtn.disabled = !deploying || ops.length === 0;
    clearBtn.disabled = !deploying || (ops.length === 0 && cfg.size === 0);
    deployBtn.disabled = !deploying || submitting;
    deployBtn.textContent = submitting ? 'Deploying…' : 'Deploy & Fight';
    renderCards();
    renderShopSpacing();
  }

  function renderShopSpacing() {
    const d = phase === 'deploy' ? deck()[selCard] : undefined;
    if (!d) { shopSpacingEl.classList.add('hidden'); shopSpacingEl.replaceChildren(); return; }
    shopSpacingEl.classList.remove('hidden');
    const squad = hasSpacing(sizeOf(d));
    shopSpacingEl.replaceChildren(squad ? spacingControl(spacingOfCard(d), (v) => setCardSpacing(v), footOf(d)) : '');
    shopSpacingEl.classList.toggle('hidden', !squad);
  }

  function escortUi(sl: NonNullable<Sel>): EscortUi {
    const e = blockEscort(sl);
    const tp = e != null ? place.find((x) => x.uid === e) ?? me().board.find((x) => x.uid === e) : undefined;
    return {
      label: e != null ? designOf(side, tp?.designId ?? '')?.name ?? `#${e}` : null,
      picking: escortPick?.uid === sl.uid && escortPick.pending === sl.pending,
      onPick: () => { escortPick = escortPick?.uid === sl.uid ? null : sl; renderAll(); },
      onClear: () => setBlockOrders(sl, { escort: -1 }),
    };
  }
  type OrdersPatch = Partial<Orders> & { escort?: number }; // escort -1 = clear
  const blockSrc = (sl: NonNullable<Sel>) => (sl.pending ? place.find((x) => x.uid === sl.uid) : m.players[sl.side].board.find((x) => x.uid === sl.uid));
  const blockOrders = (sl: NonNullable<Sel>): Orders | null => {
    const p = blockSrc(sl);
    if (!p) return null;
    const c = sl.pending ? undefined : cfg.get(p.uid);
    return ordersOf({ ...p, ...(c ?? {}) });
  };
  const blockEscort = (sl: NonNullable<Sel>): number | undefined => {
    const p = blockSrc(sl);
    if (!p) return undefined;
    const e = sl.pending ? p.escort : cfg.get(p.uid)?.escort ?? p.escort;
    return e != null && e >= 0 ? e : undefined;
  };
  let escortPick: NonNullable<Sel> | null = null;

  /** change battle orders of one of my blocks (pending: stored on the placement, locked: via `configure`) */
  function setBlockOrders(sl: NonNullable<Sel>, patch: OrdersPatch) {
    if (phase !== 'deploy' || sl.side !== side) return;
    const cur = blockOrders(sl);
    if (!cur) return;
    const { escort: escPatch, ...op } = patch;
    const next: Orders = { ...cur, ...op };
    const esc = escPatch === undefined ? blockEscort(sl) : escPatch >= 0 ? escPatch : undefined;
    if (sl.pending) {
      const i = place.findIndex((x) => x.uid === sl.uid);
      if (i < 0) return;
      const { target: _t, hold: _h, kite: _k, kiteMount: _km, focus: _f, stance: _s, delay: _d, retreat: _r, escort: _e, ...rest } = place[i];
      const np: Placement = { ...rest, ...orderFields({ ...next, hold: next.hold && hasSpacing(sizeOf(designOf(side, rest.designId))) }), ...(esc != null ? { escort: esc } : {}) };
      const cand = action();
      cand.place[i] = np;
      const err = check(cand);
      if (err) { sfx('invalid'); app.toast(err, 'error'); return; }
      place[i] = np;
    } else {
      const base = m.players[side].board.find((x) => x.uid === sl.uid);
      if (!base) return;
      const prev = cfg.get(sl.uid);
      const entry: UnitConfig = { uid: sl.uid, ...next, escort: esc ?? -1 };
      const same = ordersEqual(next, ordersOf(base)) && (esc ?? -1) === (base.escort ?? -1);
      if (same) cfg.delete(sl.uid); else cfg.set(sl.uid, entry);
      const err = check(action());
      if (err) { if (prev) cfg.set(sl.uid, prev); else cfg.delete(sl.uid); sfx('invalid'); app.toast(err, 'error'); return; }
    }
    sfx('click');
    renderAll();
  }

  function dropEscortsTo(uid: number) {
    place = place.map((p) => { if (p.escort !== uid) return p; const { escort: _e, ...r } = p; return r; });
    for (const [k, c] of cfg) if (c.escort === uid) { const b = m.players[side].board.find((x) => x.uid === k); if (b?.escort != null && b.escort >= 0) c.escort = -1; else cfg.delete(k); }
    for (const b of m.players[side].board) if (b.escort === uid && !cfg.has(b.uid)) cfg.set(b.uid, { uid: b.uid, ...ordersOf(b), escort: -1 });
  }

  function setCardSpacing(v: number) {
    const d = deck()[selCard];
    if (!d || !hasSpacing(sizeOf(d))) return;
    lastSpacing.set(d.id, normSpacing(sizeOf(d), v));
    if (lastPtr) hover = computeHover(lastPtr.px, lastPtr.py);
    sfx('click');
    renderAll();
  }

  /** change spacing of a block placed this round; reverts (with a toast) if it would collide */
  function setPendingSpacing(uid: number, v: number) {
    const i = place.findIndex((p) => p.uid === uid);
    if (i < 0) return;
    const p = place[i];
    const size = sizeOf(designOf(side, p.designId));
    if (!hasSpacing(size)) return;
    const sp = normSpacing(size, v);
    if (sp === normSpacing(size, p.spacing)) return;
    const bd = blockDims(size, sp, footOf(designOf(side, p.designId)), p.rot);
    const next: Placement = { ...p, spacing: sp, x: Math.max(0, Math.min(DEPLOY_W - bd.w, p.x)), y: Math.max(0, Math.min(DEPLOY_D - bd.h, p.y)) };
    const cand = action();
    cand.place[i] = next;
    const err = check(cand);
    if (err) { sfx('invalid'); app.toast(err, 'error'); renderAll(); return; }
    place[i] = next;
    lastSpacing.set(p.designId, sp);
    sfx('click');
    renderAll();
  }

  /** R: turn the squad about to be placed, else the selected squad placed this round, by 90° (reverts if it won't fit) */
  function rotateBlock(): boolean {
    if (phase !== 'deploy') return false;
    const d = deck()[selCard];
    if (d) {
      if (!hasSpacing(sizeOf(d))) { app.toast('Only squads can be rotated'); return true; }
      rotCard = !rotCard;
      if (lastPtr) hover = computeHover(lastPtr.px, lastPtr.py);
      sfx('click');
      renderAll();
      return true;
    }
    if (!(sel?.pending && sel.side === side)) return false;
    const i = place.findIndex((x) => x.uid === sel!.uid);
    if (i < 0) return false;
    const p = place[i];
    const dd = designOf(side, p.designId);
    const size = sizeOf(dd);
    if (!hasSpacing(size)) { app.toast('Only squads can be rotated'); return true; }
    const rot = !p.rot;
    const bd = blockDims(size, p.spacing, footOf(dd), rot);
    // turn about the block's centre, then nudge back inside the zone
    const old = blockDims(size, p.spacing, footOf(dd), p.rot);
    const cx = p.x + old.w / 2, cy = p.y + old.h / 2;
    const x = Math.max(0, Math.min(DEPLOY_W - bd.w, Math.round(cx - bd.w / 2)));
    const y = Math.max(0, Math.min(DEPLOY_D - bd.h, Math.round(cy - bd.h / 2)));
    const next: Placement = { ...p, x, y, ...(rot ? { rot: true } : {}) };
    if (!rot) delete next.rot;
    const cand = action();
    cand.place[i] = next;
    const err = check(cand);
    if (err) { sfx('invalid'); app.toast(err, 'error'); return true; }
    place[i] = next;
    sfx('click');
    renderAll();
    return true;
  }

  /** [ ] / Shift+wheel: step the spacing of the card being placed, else of the selected pending squad */
  function stepSpacing(dir: number): boolean {
    if (phase !== 'deploy') return false;
    const d = deck()[selCard];
    if (d && hasSpacing(sizeOf(d))) { setCardSpacing(Math.max(0, Math.min(MAX_SPACING, spacingOfCard(d) + dir))); return true; }
    if (sel?.pending && sel.side === side) {
      const p = place.find((x) => x.uid === sel!.uid);
      if (p && hasSpacing(sizeOf(designOf(side, p.designId)))) { setPendingSpacing(p.uid, Math.max(0, Math.min(MAX_SPACING, normSpacing(1, p.spacing) + dir))); return true; }
    }
    return false;
  }

  function renderHint() {
    let t = '';
    if (phase === 'deploy' && escortPick) t = 'Click a friendly block to escort · Esc to cancel';
    else if (phase === 'deploy') {
      const d = deck()[selCard];
      if (d) t = hover && !hover.valid && hover.reason ? hover.reason : `Place ${d.name}${squadOf(d) > 1 ? ' squad' : ''} in your zone${hasSpacing(sizeOf(d)) ? ' · [ ] spacing · R rotate' : ''} · Esc to cancel`;
      else t = place.length ? 'Tap a new block to adjust or remove it · tap your units to upgrade' : 'Pick a unit card, then tap your zone to deploy';
    } else if (phase === 'battle') t = 'Battle in progress';
    hintEl.textContent = t;
    hintEl.classList.toggle('hidden', !t);
    const cd = phase === 'deploy' && !escortPick ? deck()[selCard] : undefined;
    const cst = cd && statsOf(cd);
    if (cd && cst) miniEl.replaceChildren(miniStats(cd, cst)); else miniEl.replaceChildren();
    miniEl.classList.toggle('hidden', !cst);
  }

  function renderSpeed() {
    speedBtns.forEach((b, i) => b.classList.toggle('active', BATTLE_SPEEDS[i] === speed));
    speedbar.classList.toggle('hidden', phase !== 'battle');
    rangeBar.classList.toggle('hidden', phase !== 'deploy' && phase !== 'waiting');
  }

  // ---------- info panel ----------
  const narrow = () => window.matchMedia('(max-width: 760px), (hover: none)').matches;
  const onRingHi = (k: string | null) => { ringHi = k; };
  /** while placing (card selected, nothing selected) the panel previews the card's stats; hidden on phones */
  function renderCardPreview(): boolean {
    const d = phase === 'deploy' && !sel && !narrow() ? deck()[selCard] : undefined;
    const st = d && statsOf(d);
    if (!d || !st) return false;
    const prev = h('canvas');
    infoEl.replaceChildren(
      h('button.icon.small.ghost.close', { onclick: () => { selCard = -1; hover = null; renderAll(); } }, '✕'),
      h('div.head', null, prev, h('div', null,
        h('h3.friendly', null, d.name),
        h('div.sc-sub', null, 'Placing · ', h('span.sc-cost', null, svgIcon('cost', 16), String(st.cost)))),
      ),
      statCard({ design: d, st, level: 1, spacing: spacingOfCard(d), onRing: onRingHi }),
    );
    infoEl.classList.remove('hidden');
    infoEl.classList.remove('picking');
    requestAnimationFrame(() => paintPreview(prev, d, 0));
    return true;
  }
  function renderInfo() {
    if (!sel || (phase !== 'deploy' && phase !== 'waiting')) {
      if (!renderCardPreview()) { infoEl.classList.add('hidden'); ringHi = null; }
      return;
    }
    const s = sel;
    const p = s.pending ? place.find((x) => x.uid === s.uid) : m.players[s.side].board.find((x) => x.uid === s.uid);
    const d = p && designOf(s.side, p.designId);
    const st = d && statsOf(d);
    if (!p || !d || !st) { sel = null; infoEl.classList.add('hidden'); return; }
    hideTip();
    const mine = s.side === side;
    const ups = mine && !s.pending ? pendingUps(p.uid) : 0;
    const lv = p.level + ups;
    const squad = st.squad ?? 1;
    const sp = normSpacing(st.size, p.spacing);
    const prev = h('canvas');
    const parts = [CHASSIS_BY_ID.get(d.chassis)?.name, MOBILITY_BY_ID.get(d.mobility)?.name].filter(Boolean).join(' · ');
    const actions: HTMLElement[] = [];
    if (mine && phase === 'deploy') {
      if (s.pending) {
        if (hasSpacing(st.size)) actions.push(h('button.small', { title: 'Turn the formation 90° (R)', onclick: () => rotateBlock() }, '⟳ Rotate'));
        actions.push(h('button.small.danger', { onclick: () => removePending(p.uid) }, 'Remove (refund)'));
      } else {
        if (lv < MAX_LEVEL) {
          let cost = 0;
          try { cost = upgradeCost(d, lv); } catch { /* */ }
          const cand = action();
          cand.upgrade.push(p.uid);
          const err = cost > remaining() ? 'Not enough supply' : check(cand);
          actions.push(h('button.small.warn', { onclick: () => upgrade(p.uid), disabled: !!err, title: err ?? '' }, `Upgrade · ${cost}`));
        } else actions.push(h('button.small', { disabled: true }, 'Max level'));
        if (ups) actions.push(h('button.small', { onclick: () => undoUpgrade(p.uid) }, 'Undo upgrade'));
      }
    }
    infoEl.replaceChildren(
      h('button.icon.small.ghost.close', { onclick: () => { sel = null; renderAll(); } }, '✕'),
      h('div.head', null, prev, h('div', null,
        h('h3', { class: mine ? 'friendly' : 'enemy' }, d.name),
        h('div.stars', null, stars(lv), ups ? h('span.good', { style: { fontSize: '0.85rem', marginLeft: '6px' } }, `+${ups} pending`) : null),
        h('div.sc-sub', null, `${mine ? (s.pending ? 'New this round' : `Deployed round ${p.round}`) : 'Enemy unit'} · `, h('span.sc-cost', null, svgIcon('cost', 16), String(st.cost)), squad > 1 ? h('span.sc-blk', null, ` block of ${squad}`) : null),
      )),
      statCard({ design: d, st, level: lv, spacing: sp, upgraded: ups > 0, onRing: onRingHi }),
      mine && blockOrders(s) ? h('div.info-spacing', null, ordersControl(blockOrders(s)!, squad > 1, (patch) => { if (phase === 'deploy') setBlockOrders(s, patch); }, phase === 'deploy' ? { escort: escortUi(s), kiteOptions: kiteOptions(designOf(s.side, p.designId)) } : {})) : '',
      squad > 1 ? h('div.info-spacing', null, spacingControl(sp, mine && phase === 'deploy' && s.pending ? (v) => setPendingSpacing(p.uid, v) : null, footOf(d))) : '',
      h('div.parts', null, parts),
      actions.length ? h('div.actions', null, ...actions) : '',
    );
    infoEl.classList.remove('hidden');
    infoEl.classList.toggle('picking', !!escortPick);
    requestAnimationFrame(() => paintPreview(prev, d, mine ? 0 : 1));
  }

  // ---------- overlays (waiting / result / game over) ----------
  function renderOverlay() {
    overlayEl.replaceChildren();
    if (phase === 'waiting') {
      const noOpp = m.status === 'waiting';
      overlayEl.append(h('div.panel.waiting', null,
        h('div.spinner'),
        h('h3', null, noOpp ? 'Waiting for an opponent' : `Waiting for ${foe().name || driver.opponentName()}…`),
        h('p.muted', null, noOpp
          ? 'Your match is listed in the lobby. The battle starts once someone joins and deploys.'
          : 'Your deployment is locked in. This is async — leave and come back any time; the battle replays when you return.'),
        h('div.row', { style: { justifyContent: 'center' } }, h('button', { onclick: () => leave() }, driver.mode === 'pvp' ? 'Back to lobby' : 'Main menu')),
      ));
    } else if (phase === 'result' && replay) {
      const r = replay.result;
      const won = r.winner === side, lost = r.winner === opp;
      const cont = h('button.primary', { onclick: () => continueAfterResult() }, m.status === 'done' && !m.history.some((x) => x.round > replay!.round) ? 'See result' : 'Continue');
      overlayEl.append(h('div.panel.banner', { class: won ? 'win' : lost ? 'lose' : 'draw' },
        h('h4', null, `Round ${replay.round}`),
        h('h1', null, won ? 'Round won' : lost ? 'Round lost' : 'Draw'),
        h('div.lines', null,
          ...(lastDmg?.round === replay.round ? [
            h('span', null, 'Unit damage dealt'), h('b.good', null, sideDamage(side).toLocaleString()),
            h('span', null, 'Unit damage taken'), h('b.bad', null, sideDamage(opp).toLocaleString()),
          ] : []),
          // commander HP lost this round, with what's left after it
          h('span', null, 'Enemy commander'), h('b', null, h(r.damage[opp] ? 'span.good' : 'span', null, r.damage[opp] ? `−${r.damage[opp]} HP` : 'unhurt'), h('small.muted', null, ` · ${Math.max(0, hpAt(opp, replay.round))} left`)),
          h('span', null, 'Your commander'), h('b', null, h(r.damage[side] ? 'span.bad' : 'span', null, r.damage[side] ? `−${r.damage[side]} HP` : 'unhurt'), h('small.muted', null, ` · ${Math.max(0, hpAt(side, replay.round))} left`)),
          h('span', null, 'Your survivors'), h('b', null, `${r.survivors[side].length} / ${replay.boards[side].length}`),
          h('span', null, 'Enemy survivors'), h('b', null, `${r.survivors[opp].length} / ${replay.boards[opp].length}`),
        ),
        h('div.actions', null, cont),
      ));
      setTimeout(() => cont.focus({ preventScroll: true }), 50);
    } else if (phase === 'over') {
      const won = m.winner === side, lost = m.winner === opp;
      const roundsWon = m.history.filter((r) => r.result.winner === side).length;
      const dealt = m.history.reduce((s, r) => s + r.result.damage[opp], 0);
      const taken = m.history.reduce((s, r) => s + r.result.damage[side], 0);
      const buttons: HTMLElement[] = [];
      if (driver instanceof LocalDriver) buttons.push(h('button.primary', { onclick: () => rematch() }, 'Rematch'));
      if (driver.mode === 'pvp') buttons.push(h('button.primary', { onclick: () => app.go({ name: 'lobby' }) }, 'Back to lobby'));
      buttons.push(h('button', { onclick: () => app.go({ name: 'menu' }) }, 'Main menu'));
      overlayEl.append(h('div.gameover-back'), h('div.panel.banner', { class: won ? 'win' : lost ? 'lose' : 'draw' },
        h('h4', null, `vs ${foe().name}`),
        h('h1', null, won ? 'Victory' : lost ? 'Defeat' : 'Draw'),
        h('div.lines', null,
          h('span', null, 'Rounds played'), h('b', null, String(m.history.length)),
          h('span', null, 'Rounds won'), h('b', null, `${roundsWon}`),
          h('span', null, 'Commander damage dealt'), h('b.good', null, String(dealt)),
          h('span', null, 'Commander damage taken'), h('b.bad', null, String(taken)),
          h('span', null, 'Units fielded'), h('b', null, String(me().board.length)),
          h('span', null, 'Final HP'), h('b', null, `${Math.max(0, me().hp)} – ${Math.max(0, foe().hp)}`),
        ),
        h('div.actions', null, ...buttons),
      ));
    }
  }

  function renderAll() {
    renderTop();
    renderSide();
    renderHint();
    renderInfo();
    renderSpeed();
  }

  // ---------- deploy actions ----------
  const newOrders = (designId: string, size: Size) => { const o = ordersOf(designOf(side, designId)?.behavior); return orderFields({ ...o, hold: hasSpacing(size) && o.hold }); };

  function computeHover(px: number, py: number): typeof hover {
    const d = deck()[selCard];
    if (!d) return null;
    const size = sizeOf(d);
    const spacing = spacingOfCard(d);
    const rot = rotCard && hasSpacing(size);
    const { w: bw, h: bh } = blockDims(size, spacing, footOf(d), rot);
    let wp: { x: number; y: number };
    try { wp = view.screenToWorld(px, py); } catch { return null; }
    const col = Math.round(wp.x - bw / 2), row = Math.round(wp.y - bh / 2);
    let { x, y } = worldToLocalRect(side, col, row, bw, bh);
    if (y > DEPLOY_D + 2 || y < -bh - 1 || x < -bw - 1 || x > DEPLOY_W + 1) return null; // far outside our zone
    x = Math.max(0, Math.min(DEPLOY_W - bw, x));
    y = Math.max(0, Math.min(DEPLOY_D - bh, y));
    let reason: string | null = null;
    if (!blockInZone(x, y, size, spacing, footOf(d), rot)) reason = 'Outside your deploy zone';
    else if (costOf(d) > remaining()) reason = 'Not enough supply';
    else {
      const cand = action();
      cand.place.push({ uid: nextUid, designId: d.id, x, y, level: 1, round: m.round, ...(hasSpacing(size) ? { spacing } : {}), ...(rot ? { rot: true } : {}), ...newOrders(d.id, size) });
      reason = check(cand);
    }
    return { x, y, size, spacing, rot, w: bw, h: bh, valid: !reason, reason };
  }

  function placeAt(px: number, py: number) {
    hover = computeHover(px, py);
    const d = deck()[selCard];
    if (!hover || !d) return;
    if (!hover.valid) {
      sfx('invalid');
      if (hover.reason) app.toast(hover.reason, 'error');
      return;
    }
    const uid = nextUid++;
    place.push({ uid, designId: d.id, x: hover.x, y: hover.y, level: 1, round: m.round, ...(hasSpacing(hover.size) ? { spacing: hover.spacing } : {}), ...(hover.rot ? { rot: true } : {}), ...newOrders(d.id, hover.size) });
    ops.push({ kind: 'place', uid });
    sfx('place');
    if (costOf(d) > remaining()) { selCard = -1; hover = null; }
    else hover = computeHover(px, py);
    renderAll();
  }

  function removePending(uid: number) {
    place = place.filter((p) => p.uid !== uid);
    dropEscortsTo(uid);
    ops = ops.filter((o) => !(o.kind === 'place' && o.uid === uid));
    if (sel?.pending && sel.uid === uid) sel = null;
    sfx('click');
    renderAll();
  }

  function upgrade(uid: number) {
    const cand = action();
    cand.upgrade.push(uid);
    const err = check(cand);
    if (err) { sfx('invalid'); app.toast(err, 'error'); return; }
    upgrades.push(uid);
    ops.push({ kind: 'upgrade', uid });
    sfx('upgrade');
    renderAll();
  }

  function undoUpgrade(uid: number) {
    const i = upgrades.lastIndexOf(uid);
    if (i >= 0) upgrades.splice(i, 1);
    for (let j = ops.length - 1; j >= 0; j--) if (ops[j].kind === 'upgrade' && ops[j].uid === uid) { ops.splice(j, 1); break; }
    sfx('click');
    renderAll();
  }

  function undo() {
    const o = ops.pop();
    if (!o) return;
    if (o.kind === 'place') { place = place.filter((p) => p.uid !== o.uid); dropEscortsTo(o.uid); if (sel?.pending && sel.uid === o.uid) sel = null; }
    else { const i = upgrades.lastIndexOf(o.uid); if (i >= 0) upgrades.splice(i, 1); }
    sfx('click');
    renderAll();
  }

  function clearAll() {
    cfg.clear();
    place = [];
    upgrades = [];
    ops = [];
    sel = null;
    sfx('click');
    renderAll();
  }

  async function submit() {
    if (phase !== 'deploy' || submitting) return;
    const a = action();
    const err = check(a);
    if (err) { sfx('error'); app.toast(err, 'error'); return; }
    if (!a.place.length && !a.upgrade.length) {
      const cheapest = Math.min(...deck().map(costOf));
      if (cheapest <= remaining()) {
        const ok = await confirmModal('Deploy nothing?', 'You have unspent supply and no new units or upgrades. Fight with your current army anyway?', 'Fight');
        if (!ok || destroyed) return;
      }
    }
    submitting = true;
    selCard = -1;
    hover = null;
    sel = null;
    renderAll();
    sfx('ready');
    try {
      await driver.submit(a);
    } catch (e) {
      if (!destroyed) { sfx('error'); app.toast((e as Error).message || 'Deploy failed', 'error'); }
    } finally {
      submitting = false;
    }
    if (destroyed) return;
    onState(driver.state());
  }

  // ---------- field input ----------
  const local = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    // lift the ghost above a finger so it stays visible
    const lift = e.pointerType === 'touch' ? 44 : 0;
    return { px: e.clientX - r.left, py: e.clientY - r.top - lift, rawY: e.clientY - r.top };
  };

  function unitAt(px: number, py: number): Sel {
    const hit = unitAtGround(px, py);
    // tilted view: units stand off the ground, so a click on a hull's raised top also selects it
    if (hit || !view.tilted) return hit;
    return unitAtGround(px, py + 0.28 * view.cam.k);
  }
  function unitAtGround(px: number, py: number): Sel {
    let w: { x: number; y: number };
    try { w = view.screenToWorld(px, py); } catch { return null; }
    // anywhere inside the block's footprint (including the gaps between squad units) selects the block
    const hit = (s: Side, p: Placement) => {
      const r = blockWorldRect(s, p, sizeOf(designOf(s, p.designId)), footOf(designOf(s, p.designId)));
      return w.x >= r.col && w.x <= r.col + r.w && w.y >= r.row && w.y <= r.row + r.h;
    };
    if (phase === 'deploy') for (const p of place) if (hit(side, p)) return { side, uid: p.uid, pending: true };
    for (const p of me().board) if (hit(side, p)) return { side, uid: p.uid, pending: false };
    for (const p of foe().board) if (hit(opp, p)) return { side: opp, uid: p.uid, pending: false };
    return null;
  }

  let downAt: { x: number; y: number } | null = null;
  let lpTimer = 0;
  let lpDone = false;
  /** dragging one of this round's blocks to a new spot (camera panning is off for the gesture) */
  let moveDrag: { uid: number; offX: number; offY: number; ox: number; oy: number; started: boolean; reason: string | null } | null = null;

  /** this round's (still refundable) block of ours under the pointer, if any */
  function myPendingAt(px: number, rawY: number): Placement | null {
    const hit = unitAt(px, rawY);
    return hit && hit.pending && hit.side === side ? place.find((p) => p.uid === hit.uid) ?? null : null;
  }

  /** move the dragged block under the pointer (snapped to cells, clamped to the zone) and validate it */
  function dragMoveTo(px: number, py: number) {
    if (!moveDrag) return;
    const p = place.find((q) => q.uid === moveDrag!.uid);
    const d = p && designOf(side, p.designId);
    if (!p || !d) return;
    const size = sizeOf(d);
    const { w: bw, h: bh } = blockDims(size, p.spacing, footOf(d), p.rot);
    let wp: { x: number; y: number };
    try { wp = view.screenToWorld(px, py); } catch { return; }
    let { x, y } = worldToLocalRect(side, Math.round(wp.x - moveDrag.offX), Math.round(wp.y - moveDrag.offY), bw, bh);
    x = Math.max(0, Math.min(DEPLOY_W - bw, x));
    y = Math.max(0, Math.min(DEPLOY_D - bh, y));
    if (x === p.x && y === p.y && moveDrag.started) return;
    p.x = x; p.y = y;
    moveDrag.reason = !blockInZone(x, y, size, p.spacing, footOf(d), p.rot) ? 'Outside your deploy zone' : check(action());
    hover = { x, y, size, spacing: p.spacing ?? 0, rot: p.rot, w: bw, h: bh, valid: !moveDrag.reason, reason: moveDrag.reason };
    renderHint();
  }

  canvas.addEventListener('pointerdown', (e) => {
    downAt = { x: e.clientX, y: e.clientY };
    lpDone = false;
    clearTimeout(lpTimer);
    moveDrag = null;
    if (phase === 'deploy' && selCard < 0 && !escortPick && e.button === 0) {
      const { px, rawY } = local(e);
      const p = myPendingAt(px, rawY);
      const d = p && designOf(side, p.designId);
      if (p && d) {
        let wp: { x: number; y: number } | null = null;
        try { wp = view.screenToWorld(px, rawY); } catch { /* */ }
        if (wp) {
          const r = blockWorldRect(side, p, sizeOf(d), footOf(d));
          moveDrag = { uid: p.uid, offX: wp.x - r.col, offY: wp.y - r.row, ox: p.x, oy: p.y, started: false, reason: null };
          view.controls.enabled = false; // this gesture moves the block, not the camera
        }
      }
    }
    if (e.pointerType === 'touch' && (phase === 'deploy' || phase === 'waiting') && selCard < 0) {
      const { px, rawY } = local(e);
      lpTimer = window.setTimeout(() => { // long-press a unit: peek at its stats without selecting it
        const hit = downAt && unitAt(px, rawY);
        if (hit) { lpDone = true; showUnitTip(hit, null); }
      }, 450);
    }
    try { canvas.setPointerCapture(e.pointerId); } catch { /* */ }
    if (phase === 'deploy' && selCard >= 0) {
      const { px, py } = local(e);
      hover = computeHover(px, py);
      renderHint();
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const lp = local(e);
    lastPtr = { px: lp.px, py: lp.py };
    if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 8) clearTimeout(lpTimer);
    if (moveDrag && downAt) {
      if (!moveDrag.started && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) {
        moveDrag.started = true;
        hoverUnit = null;
        if (tipKey) hideTip();
        canvas.style.cursor = 'grabbing';
      }
      if (moveDrag.started) { dragMoveTo(lp.px, lp.rawY); return; }
    }
    if (phase === 'deploy' && selCard < 0 && e.pointerType === 'mouse' && !downAt) {
      canvas.style.cursor = myPendingAt(lp.px, lp.rawY) ? 'grab' : '';
    }
    if ((phase === 'deploy' || phase === 'waiting') && (selCard < 0 || phase !== 'deploy') && e.pointerType === 'mouse') {
      const hu = unitAt(lp.px, lp.rawY);
      hoverUnit = hu && !(sel && hu.side === sel.side && hu.uid === sel.uid && hu.pending === sel.pending) ? hu : null;
    } else hoverUnit = null;
    if (e.pointerType === 'mouse') {
      if (hoverUnit) showUnitTip(hoverUnit, { x: e.clientX, y: e.clientY });
      else if (tipKey) hideTip();
    }
    if (phase !== 'deploy' || selCard < 0) return;
    if (e.pointerType === 'touch' && !downAt) return;
    const { px, py } = local(e);
    const prev = hover;
    hover = computeHover(px, py);
    if (prev?.x !== hover?.x || prev?.y !== hover?.y || prev?.valid !== hover?.valid) renderHint();
  });
  canvas.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') { hover = null; hoverUnit = null; lastPtr = null; if (tipKey) hideTip(); renderHint(); }
  });
  /** finish (or abandon) a block move: invalid spots snap back */
  function endMove(commit: boolean) {
    const md = moveDrag;
    moveDrag = null;
    view.controls.enabled = true;
    canvas.style.cursor = '';
    if (!md || !md.started) return false;
    const p = place.find((q) => q.uid === md.uid);
    if (p && (!commit || md.reason)) {
      p.x = md.ox; p.y = md.oy;
      if (commit && md.reason) { sfx('invalid'); app.toast(md.reason, 'error'); }
    } else if (p) {
      sfx('place');
      sel = { side, uid: p.uid, pending: true };
    }
    hover = null;
    renderAll();
    return true;
  }
  canvas.addEventListener('pointercancel', () => { downAt = null; hover = null; clearTimeout(lpTimer); endMove(false); });
  canvas.addEventListener('pointerup', (e) => {
    const start = downAt;
    downAt = null;
    clearTimeout(lpTimer);
    if (endMove(true)) return; // a drag-move, not a click
    if (lpDone) { lpDone = false; return; }
    if (!start || e.button > 0) return;
    if (view.wasDrag) { // end of a pan / pinch: not a click or tap
      if (e.pointerType === 'touch') { hover = null; renderHint(); }
      return;
    }
    if (phase !== 'deploy' && phase !== 'waiting') return;
    const { px, py, rawY } = local(e);
    if (phase === 'deploy' && selCard >= 0) {
      placeAt(px, py);
      if (e.pointerType === 'touch') { hover = null; renderHint(); }
      return;
    }
    const hit = unitAt(px, rawY);
    if (escortPick) {
      const pk = escortPick;
      escortPick = null;
      if (hit && phase === 'deploy' && hit.side === side && !(hit.uid === pk.uid)) setBlockOrders(pk, { escort: hit.uid });
      else { sfx('invalid'); renderAll(); }
      return;
    }
    if (hit && phase === 'deploy' && hit.pending && sel?.pending && sel.uid === hit.uid) { removePending(hit.uid); return; }
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
    if (e.key >= '1' && e.key <= '9' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const i = visibleCards[Number(e.key) - 1];
      if (i !== undefined) selectCard(i);
      e.preventDefault();
    } else if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (rotateBlock()) e.preventDefault();
    } else if ((e.key === '[' || e.key === ']') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (stepSpacing(e.key === ']' ? 1 : -1)) e.preventDefault();
    } else if (e.key === 'Escape') {
      if (tipEl?.classList.contains('sheet')) { hideTip(); return; }
      if (escortPick) escortPick = null;
      else if (selCard >= 0) { selCard = -1; hover = null; }
      else sel = null;
      renderAll();
    } else if (e.key === ' ' || e.key === 'Enter') {
      if (t && t.tagName === 'BUTTON') return; // let the focused button / kit control handle it
      e.preventDefault();
      if (phase === 'deploy') void submit();
      else if (phase === 'battle') skipBattle();
      else if (phase === 'result') continueAfterResult();
    } else if ((e.key === 'Backspace' || (e.key === 'z' && (e.ctrlKey || e.metaKey))) && phase === 'deploy') {
      e.preventDefault();
      undo();
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
    if (!e.shiftKey || phase !== 'deploy') return;
    const d = deck()[selCard];
    const can = (d && hasSpacing(sizeOf(d))) || (sel?.pending && sel.side === side);
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

  // ---------- phase machine ----------
  function setPhase(p: Phase) {
    const prev = phase;
    phase = p;
    if (p === 'waiting' && prev !== 'waiting' && m.history.length && lastDmg?.round !== m.history[m.history.length - 1].round) setTimeout(ensureLastDamage, 600);
    if (p === 'deploy' && prev !== 'deploy') {
      playMusic('deploy');
      try { view.frameDeploy(); } catch { /* */ }
      // resumed mid-match: rebuild last round's damage tally off the critical path
      if (m.history.length && lastDmg?.round !== m.history[m.history.length - 1].round) setTimeout(ensureLastDamage, 600);
    }
    if (p === 'battle' && prev !== 'battle') { try { view.fit(); } catch { /* */ } }
    renderAll();
    renderOverlay();
  }

  function evaluate() {
    if (phase === 'battle' || phase === 'result') return;
    const lw = lastWatched(m.id);
    const rec = m.history.find((r) => r.round > lw);
    if (rec) { startReplay(rec); return; }
    if (m.status === 'done') { showOver(); return; }
    if (pendingRound !== m.round) resetPending();
    else if (me().ready && (ops.length || cfg.size)) { cfg.clear(); place = []; upgrades = []; ops = []; selCard = -1; hover = null; sel = null; } // submitted: now on the board
    const blocked = me().ready || (m.status === 'waiting' && !!check({ round: m.round, place: [], upgrade: [] }));
    if (blocked) { if (phase !== 'waiting') setPhase('waiting'); else { renderAll(); renderOverlay(); } }
    else if (phase !== 'deploy') setPhase('deploy');
    else renderAll();
  }

  function onState(nm: MatchState) {
    if (destroyed) return;
    m = nm;
    statCache.clear();
    if (phase === 'battle' || phase === 'result') { renderTop(); return; }
    const deckChanged = cardEls.length !== deck().length;
    if (deckChanged) buildCards();
    evaluate();
  }

  function startReplay(rec: RoundRecord) {
    replay = rec;
    acc = 0;
    endTimer = 0;
    submitting = false;
    resetPending(); // the round already advanced; anything pending belonged to the resolved round
    battle = null;
    try {
      battle = new Battle(battleInputFor(m, rec));
    } catch (e) {
      console.error('replay failed', e);
    }
    playMusic('battle');
    setPhase('battle');
    if (!battle) showResult();
  }

  function skipBattle() {
    if (phase !== 'battle') return;
    if (battle) {
      let n = 0;
      while (!battle.done && n++ < MAX_TICKS + 100) battle.step();
    }
    showResult();
  }

  function showResult() {
    if (phase !== 'battle' || !replay) return;
    if (battle?.done) captureDamage(replay, battle);
    const r = replay.result;
    sfx(r.winner === side ? 'roundWin' : r.winner === opp ? 'roundLose' : 'click');
    setPhase('result');
  }

  function continueAfterResult() {
    if (phase !== 'result' || !replay) return;
    sfx('click');
    setLastWatched(m.id, replay.round);
    replay = null;
    phase = 'waiting'; // neutral non-deploy phase; evaluate() picks the next one (and starts deploy music)
    evaluate();
  }

  function showOver() {
    const won = m.winner === side;
    playMusic(won ? 'victory' : 'defeat');
    sfx(won ? 'victory' : 'defeat');
    setPhase('over');
  }

  function rematch() {
    if (!(driver instanceof LocalDriver)) return;
    try {
      const deckNow = activeDeck();
      const d = LocalDriver.create(driver.difficulty, deckNow.length ? deckNow : me().deck, playerName());
      app.go({ name: 'match', driver: d });
    } catch (e) {
      app.toast('Could not start rematch: ' + (e as Error).message, 'error');
    }
  }

  function leave() {
    sfx('click');
    app.go({ name: driver.mode === 'pvp' ? 'lobby' : 'menu' });
  }

  // ---------- render loop ----------
  function boardUnits(): BoardUnit[] {
    const out: BoardUnit[] = [];
    const add = (s: Side, p: Placement, extra: Partial<BoardUnit> = {}) => {
      const d = designOf(s, p.designId);
      if (!d) return;
      for (const c of placementUnitCenters(s, p, sizeOf(d), footOf(d))) out.push({ side: s, design: d, x: c.x, y: c.y, level: p.level, ...extra });
    };
    for (const p of foe().board) add(opp, p, { selected: sel?.side === opp && sel.uid === p.uid });
    for (const p of me().board) add(side, p, { level: Math.min(MAX_LEVEL, p.level + pendingUps(p.uid)), selected: sel?.side === side && !sel.pending && sel.uid === p.uid });
    if (phase === 'deploy') {
      for (const p of place) add(side, p, { selected: !!sel?.pending && sel.uid === p.uid });
      const d = deck()[selCard];
      if (hover && d) {
        for (const c of placementUnitCenters(side, { x: hover.x, y: hover.y, spacing: hover.spacing, rot: hover.rot }, hover.size, footOf(d))) {
          out.push({ side, design: d, x: c.x, y: c.y, level: 1, ghost: true, invalid: !hover.valid });
        }
      }
    }
    return out;
  }

  /** footprint rectangle (world cells) of the selected / hovered block, drawn through the overlay hover */
  function blockOutline(): BoardOverlay['hover'] {
    const t = sel ?? hoverUnit;
    if (!t) return null;
    const p = t.pending ? place.find((x) => x.uid === t.uid) : m.players[t.side].board.find((x) => x.uid === t.uid);
    const d = p && designOf(t.side, p.designId);
    if (!p || !d) return null;
    const size = sizeOf(d);
    const r = blockWorldRect(t.side, p, size, footOf(d));
    return { col: r.col, row: r.row, size: Math.max(r.w, r.h), w: r.w, h: r.h, valid: t.side === side };
  }

  // ---------- range rings overlay ----------
  interface RingTarget { side: Side; design: Design; st: UnitStats; pos: Pick<Placement, 'x' | 'y'> & { spacing?: number }; size: Size; strong: boolean; invalid?: boolean }
  const ringCtx = ringCv.getContext('2d');
  let ringW = 0, ringH = 0, ringDpr = 1, ringsShown = false;
  function clearRings() {
    if (!ringCtx || !ringsShown) return;
    ringCtx.setTransform(1, 0, 0, 1, 0, 0);
    ringCtx.clearRect(0, 0, ringCv.width, ringCv.height);
    ringsShown = false;
    legendEl.classList.add('hidden');
  }
  function rangeTargets(): RingTarget[] {
    const out: RingTarget[] = [];
    const seen = new Set<string>();
    const push = (s: Side, p: Placement | { x: number; y: number; spacing?: number; designId?: string }, d: Design | undefined, strong: boolean, key: string, invalid = false) => {
      if (!d || seen.has(key)) return;
      const st = statsOf(d);
      if (!st) return;
      seen.add(key);
      out.push({ side: s, design: d, st, pos: p, size: st.size, strong, invalid });
    };
    const keyOf = (s: Side, uid: number) => `${s}:${uid}`;
    if (phase === 'deploy' && hover && selCard >= 0) push(side, { x: hover.x, y: hover.y, spacing: hover.spacing, rot: hover.rot }, deck()[selCard], true, 'ghost', !hover.valid);
    for (const t of [sel, hoverUnit]) {
      if (!t) continue;
      const p = blockSrc(t);
      if (p) push(t.side, p, designOf(t.side, p.designId), true, keyOf(t.side, t.uid));
    }
    if (showMine || shiftDown) {
      for (const p of me().board) push(side, p, designOf(side, p.designId), false, keyOf(side, p.uid));
      if (phase === 'deploy') for (const p of place) push(side, p, designOf(side, p.designId), false, keyOf(side, p.uid));
    }
    if (showFoe) for (const p of foe().board) push(opp, p, designOf(opp, p.designId), false, keyOf(opp, p.uid));
    return out;
  }
  /** point on the outline of the rect [x0,x1]x[y0,y1] grown by r, along the ray from its centre at `ang` */
  function envelopePoint(x0: number, y0: number, x1: number, y1: number, r: number, ang: number): { x: number; y: number } {
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hw = (x1 - x0) / 2, hh = (y1 - y0) / 2;
    const dx = Math.cos(ang), dy = Math.sin(ang);
    let lo = 0, hi = r + Math.hypot(hw, hh) + 2;
    for (let i = 0; i < 22; i++) {
      const t = (lo + hi) / 2;
      const ex = Math.max(0, Math.abs(dx * t) - hw), ey = Math.max(0, Math.abs(dy * t) - hh);
      if (Math.hypot(ex, ey) < r) lo = t; else hi = t;
    }
    return { x: cx + dx * lo, y: cy + dy * lo };
  }
  function drawRanges() {
    if (!ringCtx) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (cw !== ringW || ch !== ringH || dpr !== ringDpr) {
      ringW = cw; ringH = ch; ringDpr = dpr;
      ringCv.width = Math.max(1, Math.round(cw * dpr));
      ringCv.height = Math.max(1, Math.round(ch * dpr));
    }
    const g = ringCtx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, ringCv.width, ringCv.height);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const targets = rangeTargets();
    ringsShown = targets.length > 0;
    legendEl.classList.toggle('hidden', !targets.length);
    if (!targets.length) return;
    const o = view.worldToScreen(0, 0), o1 = view.worldToScreen(1, 0);
    const k = Math.hypot(o1.x - o.x, o1.y - o.y);
    const taken: { x: number; y: number; w: number; h: number }[] = [];
    // weak (all-units) rings first so the focused block's rings sit on top
    for (const t of [...targets].sort((a, b) => Number(a.strong) - Number(b.strong))) {
      const centers = placementUnitCenters(t.side, t.pos, t.size, t.st).map((c) => view.worldToScreen(c.x, c.y));
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const c of centers) { x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y); x1 = Math.max(x1, c.x); y1 = Math.max(y1, c.y); }
      const rings = ringsOf(t.design, t.st).sort((a, b) => b.range - a.range);
      // the ring lives on the ground plane: foreshortened vertically (rounded box around the squad, an ellipse for one unit)
      const ay = view.ay;
      const uh = (y1 - y0) / ay;
      let cur = new Path2D();
      const path = (r: number) => {
        const base = new Path2D();
        base.roundRect(x0 - r, y0 - r, x1 - x0 + 2 * r, uh + 2 * r, r);
        cur = new Path2D();
        cur.addPath(base, new DOMMatrix([1, 0, 0, ay, 0, y0 * (1 - ay)]));
      };
      const angles = [-90, -62, -118, -34, -146, -10, -170].map((a) => (a * Math.PI) / 180);
      rings.forEach((rg, i) => {
        const R = rg.range * k;
        const hi = ringHi != null && rg.key === ringHi;
        const dim = ringHi != null && !hi ? 0.3 : 1;
        const sup = rg.kind === 'support';
        g.save();
        g.lineJoin = 'round';
        g.lineCap = 'round';
        if (t.strong) {
          path(R);
          g.globalAlpha = (hi ? 0.2 : sup ? 0.04 : 0.07) * dim;
          g.fillStyle = rg.color;
          g.fill(cur);
          if (rg.minRange > 0) { // dead zone: darken
            path(rg.minRange * k);
            g.globalAlpha = 0.22 * dim;
            g.fillStyle = '#000';
            g.fill(cur);
          }
          // dark under-stroke for contrast against any terrain
          path(R);
          g.globalAlpha = 0.55 * dim;
          g.strokeStyle = '#06090c';
          g.lineWidth = (hi ? 6 : 4.5);
          g.setLineDash(sup ? [1, 7] : []);
          g.stroke(cur);
          g.globalAlpha = (t.invalid ? 0.6 : 1) * dim;
          g.strokeStyle = rg.color;
          g.lineWidth = hi ? 3.5 : 2.4;
          g.stroke(cur);
          if (rg.minRange > 0) {
            path(rg.minRange * k);
            g.setLineDash([7, 6]);
            g.lineWidth = 2;
            g.globalAlpha = 0.95 * dim;
            g.strokeStyle = rg.color;
            g.stroke(cur);
          }
        } else {
          g.globalAlpha = (t.side === side ? 0.62 : 0.55);
          g.strokeStyle = rg.color;
          g.lineWidth = 1.2;
          g.setLineDash(sup ? [1, 5] : t.side === side ? [] : [6, 4]);
          path(R);
          g.stroke(cur);
          if (rg.minRange > 0) { path(rg.minRange * k); g.setLineDash([3, 4]); g.stroke(cur); }
        }
        g.restore();
        if (!t.strong && !hi) return;
        // label on the ring, nudged along the arc until it fits the viewport and misses other labels
        g.font = '700 14px "Barlow Condensed", "Barlow", system-ui, sans-serif';
        const tw = g.measureText(rg.label).width + 14, th = 20;
        for (let a = 0; a < angles.length * 2; a++) {
          const ang = angles[(i + a) % angles.length] + (a >= angles.length ? 0.12 : 0);
          const pu = envelopePoint(x0, y0, x1, y0 + uh, R, ang);
          const pt = { x: pu.x, y: y0 + (pu.y - y0) * ay };
          const lx = pt.x - tw / 2, ly = pt.y - th / 2;
          if (lx < 6 || ly < 6 || lx + tw > cw - 6 || ly + th > ch - 6) continue;
          if (taken.some((q) => lx < q.x + q.w + 3 && q.x < lx + tw + 3 && ly < q.y + q.h + 3 && q.y < ly + th + 3)) continue;
          taken.push({ x: lx, y: ly, w: tw, h: th });
          g.save();
          g.globalAlpha = dim < 1 ? 0.5 : 1;
          g.fillStyle = 'rgba(8,11,15,0.88)';
          g.strokeStyle = rg.color;
          g.lineWidth = 1.5;
          g.beginPath();
          g.roundRect(lx, ly, tw, th, 10);
          g.fill();
          g.stroke();
          g.fillStyle = '#f4f8fb';
          g.textBaseline = 'middle';
          g.textAlign = 'center';
          g.fillText(rg.label, pt.x, pt.y + 0.5);
          g.restore();
          break;
        }
      });
    }
  }

  /** keep the pinned stat panel from covering the block it describes (desktop: dock left or right) */
  function dockInfo() {
    const t = sel ?? (phase === 'deploy' && hover && selCard >= 0 ? { side, uid: -1, pending: true } : null);
    if (!t || infoEl.classList.contains('hidden') || window.matchMedia('(max-width: 760px), (hover: none)').matches) return;
    let cx: number | null = null;
    if (sel) {
      const p = blockSrc(sel);
      const d = p && designOf(sel.side, p.designId);
      if (p && d) cx = view.worldToScreen(...(Object.values(blockWorldRectCenter(sel.side, p, sizeOf(d), footOf(d))) as [number, number])).x;
    } else if (hover) {
      const r = blockWorldRect(side, { x: hover.x, y: hover.y, spacing: hover.spacing, rot: hover.rot }, hover.size, footOf(deck()[selCard]));
      cx = view.worldToScreen(r.col + r.w / 2, r.row + r.h / 2).x;
    }
    if (cx == null) return;
    const W = canvas.clientWidth;
    if (cx < 390) infoEl.classList.add('right');
    else if (cx > W - 450) infoEl.classList.remove('right');
  }
  const blockWorldRectCenter = (s: Side, p: Placement, size: Size, foot?: UnitFoot) => { const r = blockWorldRect(s, p, size, foot); return { x: r.col + r.w / 2, y: r.row + r.h / 2 }; };

  let raf = 0;
  let last = performance.now();
  let drawErr = false;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    view.controls.doubleClickZoom = phase !== 'deploy' || (selCard < 0 && !sel);
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    try {
      if ((phase === 'battle' || phase === 'result' || phase === 'over') && battle) {
        if (phase === 'battle') {
          acc += dt * TICK_RATE * speed;
          let n = 0;
          while (acc >= 1 && !battle.done && n++ < 40) {
            battle.step();
            acc -= 1;
            view.pushEvents?.(battle.events);
          }
          if (battle.done) {
            endTimer += dt;
            if (endTimer > 1.2) showResult();
          }
        }
        view.drawBattle(battle, dt);
        clearRings();
      } else {
        let hov: BoardOverlay['hover'] = null;
        if (hover && phase === 'deploy') {
          const r = blockWorldRect(side, { x: hover.x, y: hover.y, spacing: hover.spacing, rot: hover.rot }, hover.size, footOf(deck()[selCard]));
          hov = { col: r.col, row: r.row, size: Math.max(r.w, r.h), w: r.w, h: r.h, valid: hover.valid };
        } else if (phase === 'deploy' || phase === 'waiting') hov = blockOutline();
        view.drawBoard(boardUnits(), { showZone: phase === 'deploy', hover: hov }, now / 1000);
        drawRanges();
        dockInfo();
      }
    } catch (e) {
      if (!drawErr) { drawErr = true; console.error('field draw', e); }
    }
  };

  const ro = new ResizeObserver(() => { try { view.resize(); } catch { /* */ } });
  ro.observe(fieldwrap);
  let paintTimer = 0;
  const onResize = () => { clearTimeout(paintTimer); paintTimer = window.setTimeout(paintCards, 150); };
  window.addEventListener('resize', onResize);

  const unsub = driver.subscribe((nm) => onState(nm));
  driver.start();

  buildCards();
  phase = 'waiting'; // forces setPhase('deploy') to start deploy music on first evaluate
  evaluate();
  requestAnimationFrame(() => {
    try { view.resize(); if (phase === 'deploy') view.frameDeploy(true); else if (phase === 'battle') view.fit(true); } catch { /* */ }
    raf = requestAnimationFrame(frame);
  });

  return {
    el,
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('keydown', onShift);
      document.removeEventListener('keyup', onShift);
      window.removeEventListener('blur', onBlur);
      hideTip();
      fieldwrap.removeEventListener('wheel', onWheel, true);
      unsub();
      driver.stop();
      try { view.destroy(); } catch { /* */ }
    },
  };
}
