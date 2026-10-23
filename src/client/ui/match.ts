// Main gameplay screen: deploy phase (shop + placement on the field), waiting (pvp), battle replay,
// round result, game over. Works with any MatchDriver (LocalDriver for AI, NetDriver for PvP).

import { h, type App, type Route, type Screen } from '../app.ts';
import { playMusic, sfx } from '../audio.ts';
import { activeDeck } from '../collection.ts';
import type { MatchDriver } from '../driver.ts';
import { LocalDriver, lastWatched, setLastWatched } from '../localdriver.ts';
import { drawPartIcon, type PartKind, type BoardOverlay, type BoardUnit } from '../render/field.ts';
import type { BattleView } from '../render/view.ts';
import { makeView } from '../render/viewfactory.ts';
import { applyViewSettings, loadSettings } from '../storage.ts';
import { Battle } from '../../shared/sim/battle.ts';
import { MAX_TICKS, TICK_RATE, type BattleEvent, type SimUnit } from '../../shared/sim/types.ts';
import type { BlockShape } from '../../shared/grid.ts';
import { DEPLOY_D, DEPLOY_W, FIELD_H, FIELD_W, MAX_SPACING, blockDims, blockInZone, blockWorldRect, fmtMeters, fmtSpeed, forwardY, hasSpacing, localToWorldCell, normSpacing, placementUnitCenters, squadOffsets } from '../../shared/grid.ts';
import { bodyScale, hullK, mountOffsets } from '../../shared/mountgeo.ts';
import { TILT_SIN, flyHeight, hullHeight } from '../render/tilt.ts';
import { battleInputFor, MAX_BLOCKS, MAX_SIM_UNITS, placementValue, SELL_REFUND, sellValue, START_HP, upgradeCost, validateDeploy } from '../../shared/match.ts';
import { CHASSIS_BY_ID, MOBILITY_BY_ID, MODULE_BY_ID } from '../../shared/parts.ts';
import { LEVEL_BONUS, MAX_LEVEL, computeStats, defaultOrders, fmtUnitPrice, levelMult } from '../../shared/stats.ts';
import { type DeployAction, type Design, type MatchState, type Placement, type RoundRecord, type Side, type Size, type UnitConfig, type UnitStats } from '../../shared/types.ts';
import * as kit from './kit.ts';
import { mapForRound } from '../render/ground.ts';
import { BATTLE_SPEEDS, speedLabel } from '../storage.ts';
import { RING_COLOR, confirmModal, kiteOptions, miniStats, ordersControl, ordersEqual, ordersOf, orderFields, paintPreview, ringsOf, sizeLabel, statCard, svgIcon, type EscortUi, type Orders } from './match-ui.ts';
import { playerName } from './vsai.ts';
import { designInfo, type DesignInfo } from './deckstats.ts';
import { hpAfterRound, totalDamageTaken } from './matchmath.ts';

type Phase = 'deploy' | 'waiting' | 'battle' | 'result' | 'over';

/** Inverse of localRectToWorld: top-left world cell of a w x h rectangle -> local deploy-grid coords for `side`. */
export function worldToLocalRect(side: Side, col: number, row: number, w: number, h: number): { x: number; y: number } {
  if (side === 0) return { x: col, y: row - (FIELD_H - DEPLOY_D) };
  return { x: FIELD_W - col - w, y: DEPLOY_D - row - h };
}

/** last spacing chosen per design id (kept across matches) */
const lastSpacing = new Map<string, number>();

/** Tiny diagram of a squad (its real cols x rows formation) at the given spacing, plus the footprint in metres. */
function spacingDiagram(spacing: number, shape: BlockShape, rot = false): SVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const { w: cw, h: ch } = blockDims(shape, spacing, rot);
  const px = Math.max(1.5, Math.min(4, 120 / cw));
  const svg = document.createElementNS(NS, 'svg');
  const W = cw * px, H = ch * px;
  // square view of at least 30 units (~7.5 cells): small squads (4 x 2, 2 x 2) draw at the same scale as a packed 8 x 2
  // one instead of being blown up to fill the fixed-size diagram
  const S = Math.max(W, H, 30);
  svg.setAttribute('viewBox', `${(W - S) / 2} ${(H - S) / 2} ${S} ${S}`);
  svg.setAttribute('width', String(Math.round(W * 0.9)));
  svg.setAttribute('height', String(Math.round(H * 0.9 + 4)));
  svg.setAttribute('class', 'sp-diagram');
  svg.setAttribute('aria-hidden', 'true');
  const r = document.createElementNS(NS, 'rect');
  r.setAttribute('x', '0.5'); r.setAttribute('y', '0.5'); r.setAttribute('width', String(W - 1)); r.setAttribute('height', String(H - 1));
  r.setAttribute('class', 'fp');
  svg.append(r);
  for (const o of squadOffsets(shape, spacing, rot)) {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', String(o.x * px)); c.setAttribute('cy', String(o.y * px)); c.setAttribute('r', '1.4');
    svg.append(c);
  }
  return svg;
}

/** Segmented spacing control: "Spacing 0 1 2" + live diagram + footprint size. */
/** `rot`: the block is turned 90° (footprint and diagram follow it) */
export function spacingControl(value: number, onPick: ((v: number) => void) | null, shape: BlockShape, rot = false): HTMLElement {
  const segs = kit.segmented({
    value, label: 'Squad spacing', disabled: !onPick,
    options: Array.from({ length: MAX_SPACING + 1 }, (_, v) => ({ value: v, label: String(v), title: `${v} empty ${v === 1 ? 'cell' : 'cells'} between units` })),
    onChange: (v) => onPick?.(v),
  });
  const d = blockDims(shape, value, rot);
  return h('div.spacing', null,
    h('div.sp-head', null, h('span', null, 'Spacing'), h('span.muted', null, ...(onPick ? [h('kbd', null, '['), ' ', h('kbd', null, ']')] : ['locked']))),
    h('div.sp-row', null, spacingDiagram(value, shape, rot), segs),
    h('div.sp-foot', null, `Footprint ${fmtMeters(d.w)} × ${fmtMeters(d.h)}`),
  );
}

type Op = { kind: 'place' | 'upgrade' | 'sell'; uid: number };
type Sel = { side: Side; uid: number; pending: boolean } | null;
type FieldWithEvents = BattleView;

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
  /** block shape (size, squad count, unit footprint) every grid helper takes: the design's stats, so the squad count
   *  has one source (computeStats). An unpriceable design is one 1x1 unit. */
  const shapeOf = (d: Design | undefined): BlockShape => (d && statsOf(d)) || { size: 1, squad: 1 };
  const costOf = (d: Design | undefined): number => (d ? statsOf(d)?.cost ?? 0 : 0);
  const squadOf = (d: Design | undefined): number => (d ? statsOf(d)?.squad ?? 1 : 1);
  const spacingOfCard = (d: Design): number => normSpacing(shapeOf(d), lastSpacing.get(d.id) ?? 0);

  // ---------- deploy state ----------
  let pendingRound = -1;
  let place: Placement[] = [];
  let upgrades: number[] = [];
  /** units from earlier rounds sold this turn (refund SELL_REFUND of their investment) */
  let sold: number[] = [];
  let ops: Op[] = [];
  let nextUid = 1;
  let selCard = -1;
  let sel: Sel = null;
  /** box / shift-click group selection of my blocks (2+); their battle orders are edited together */
  let multi: NonNullable<Sel>[] = [];
  const inMulti = (s: Side, uid: number, pending: boolean) => multi.some((x) => x.side === s && x.uid === uid && x.pending === pending);
  let hover: { x: number; y: number; shape: BlockShape; spacing: number; rot?: boolean; w: number; h: number; valid: boolean; reason: string | null } | null = null;
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
    if (destroyed || !rec || lastDmg?.round === rec.round) return; // (also runs off a timer: skip once the screen is gone)
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
    // the sim tallies damage per block: for a squad this is all its units together
    const p = m.players[sd].board.find((b) => b.uid === uid);
    const sq = squadOf(p && designOf(sd, p.designId));
    return h('div.sc-dmg', { title: sq > 1 ? `Damage dealt by all ${sq} units of this squad in round ${lastDmg.round}` : null },
      h('span', null, `Round ${lastDmg.round} damage${sq > 1 ? ' · squad' : ''}`),
      h('b', null, v.toLocaleString()),
      v > 0 && ranked.length > 1 ? h('em', null, rank === 1 ? 'top of army' : `#${rank} of ${ranked.length} blocks`) : null);
  };
  let acc = 0;
  let endTimer = 0;
  /** last round replayed on this screen */
  let watchedHere = 0;
  let destroyed = false;

  const me = () => m.players[side];
  const foe = () => m.players[opp];
  const deck = () => me().deck;
  const action = (): DeployAction => ({ round: m.round, place: place.map((p) => ({ ...p })), upgrade: [...upgrades], ...(sold.length ? { sell: [...sold] } : {}), ...(cfg.size ? { configure: [...cfg.values()].map((c) => ({ ...c })) } : {}) });
  /** a side's board as the player sees it this turn (my sold units are gone) */
  const boardOf = (s: Side): Placement[] => (s === side && sold.length ? me().board.filter((b) => !sold.includes(b.uid)) : m.players[s].board);
  const myBoard = () => boardOf(side);
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
    for (const uid of sold) {
      const u = me().board.find((b) => b.uid === uid);
      const d = u && designOf(side, u.designId);
      if (u && d) c -= sellValue(d, u.level);
    }
    return c;
  }
  const remaining = () => me().supply - spent();

  function resetPending() {
    pendingRound = m.round;
    place = [];
    upgrades = [];
    sold = [];
    ops = [];
    cfg.clear();
    nextUid = me().nextUid;
    selCard = -1;
    sel = null;
    multi = [];
    hover = null;
  }

  // ---------- DOM ----------
  const canvas = h('canvas');
  const ringCv = h('canvas.rings', { 'aria-hidden': 'true' });
  const boxEl = h('div.box-select.hidden', { 'aria-hidden': 'true' });
  const fieldwrap = h('div.fieldwrap', null, canvas, ringCv, boxEl);
  const view: FieldWithEvents = makeView(canvas, side);
  applyViewSettings(view);

  const roundEl = h('div.round');
  const hpMe = h('div.hp.me');
  const hpFoe = h('div.hp.foe');
  const leaveBtn = h('button.icon.small', { title: 'Leave match', onclick: () => leave() }, '‹', h('span.hide-sm', null, 'Leave'));
  const topbar = h('div.mbar', null, leaveBtn, hpMe, roundEl, hpFoe);

  const supplyVal = h('div.val');
  // army caps: blocks (purchases) and simulated units (a light squad is 4, 8 or 16 of them)
  const capEl = h('div.capmeter');
  let capWarned = false;
  function capUse() {
    let units = 0;
    for (const p of myBoard()) units += squadOf(designOf(side, p.designId));
    for (const p of place) units += squadOf(designOf(side, p.designId));
    return { blocks: myBoard().length + place.length, units };
  }
  /** why buying one more block of d would break a cap (null = fits) */
  function capBlock(d: Design | undefined): string | null {
    if (!d) return null;
    const u = capUse();
    if (u.blocks + 1 > MAX_BLOCKS) return `Block cap reached (${MAX_BLOCKS} blocks)`;
    const sq = squadOf(d);
    if (u.units + sq > MAX_SIM_UNITS) return `Unit cap: ${u.units}/${MAX_SIM_UNITS} units on the field, ${d.name} adds ${sq}`;
    return null;
  }
  function renderCaps() {
    const u = capUse();
    const fb = u.blocks / MAX_BLOCKS, fu = u.units / MAX_SIM_UNITS, f = Math.max(fb, fu);
    const lvl = f >= 1 ? 'full' : f >= 0.8 ? 'warn' : '';
    const left = Math.min(MAX_BLOCKS - u.blocks, MAX_SIM_UNITS - u.units);
    const bar = (label: string, v: number, max: number, tip: string) => h('div.cap-row', { title: tip, class: v >= max ? 'full' : v / max >= 0.8 ? 'warn' : '' },
      h('span', null, label), h('div.cap-bar', null, h('i', { style: { width: `${Math.min(100, (100 * v) / max)}%` } })), h('b', null, `${v}/${max}`));
    capEl.className = `capmeter ${lvl}`;
    capEl.replaceChildren(
      bar('Units', u.units, MAX_SIM_UNITS, `Every unit on your side counts (a light squad is 4, 8 or 16). Max ${MAX_SIM_UNITS}.`),
      bar('Blocks', u.blocks, MAX_BLOCKS, `Each purchase is one block. Max ${MAX_BLOCKS}.`),
      lvl ? h('div.cap-banner', null, lvl === 'full'
        ? (u.units >= MAX_SIM_UNITS ? `Unit cap reached: ${MAX_SIM_UNITS} units on the field` : `Block cap reached: ${MAX_BLOCKS} blocks`)
        : `Near the army cap: ${MAX_SIM_UNITS - u.units} units / ${MAX_BLOCKS - u.blocks} blocks left`) : '',
    );
    if (lvl && phase === 'deploy' && !capWarned) { capWarned = true; app.toast(lvl === 'full' ? 'Army cap reached — no more units fit on the field.' : `Approaching the army cap (${Math.max(0, left)} left).`, lvl === 'full' ? 'error' : 'info'); }
    if (!lvl) capWarned = false;
  }
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
    h('div.side-top', null, h('div.supply', null, supplyVal, supplyLbl, h('div.spacer'), h('span.kbd-hint.muted', { style: { fontSize: '0.92rem' } }, h('kbd', null, '1-9'), ' select')), capEl),
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
  // box-select mode: plain drag on the field draws a selection box (same as Shift+drag; the only way on touch)
  let boxMode = false;
  const selBtn = h('button.small.rbtn.sel', { type: 'button', title: 'Box select: drag a rectangle over your blocks to set their orders together (or hold Shift and drag)', 'aria-pressed': 'false', onclick: () => { boxMode = !boxMode; selBtn.setAttribute('aria-pressed', String(boxMode)); selBtn.classList.toggle('active', boxMode); renderAll(); } }, svgIcon('select', 16), 'Box select');
  const rangeBar = h('div.rangebar.hidden', null, h('div.rbtns', null, mineBtn, foeBtn, selBtn), legendEl);
  function paintRangeBtns() {
    mineBtn.classList.toggle('active', showMine);
    mineBtn.setAttribute('aria-pressed', String(showMine));
    foeBtn.classList.toggle('active', showFoe);
    foeBtn.setAttribute('aria-pressed', String(showFoe));
  }
  const infoEl = h('div.panel.info.hidden');
  const speedBtns = BATTLE_SPEEDS.map((v) => h('button.small', { title: `${speedLabel(v)} speed`, onclick: () => { speed = v; paused = false; renderSpeed(); } }, speedLabel(v)));
  const skipBtn = h('button.small', { onclick: () => skipBattle() }, 'Skip ▸▸');
  let paused = false;
  const pauseBtn = h('button.small.pause-btn', { title: 'Pause / resume (Space or P)', 'aria-label': 'Pause', onclick: () => togglePause() }, '❚❚');
  function togglePause(on = !paused) { paused = on; renderSpeed(); }
  const speedbar = h('div.speedbar.hidden', null, pauseBtn, ...speedBtns, skipBtn);
  const overlayEl = h('div');
  const zoomBar = h('div.zoombtns', null,
    h('button.small', { title: 'Zoom in (+)', 'aria-label': 'Zoom in', onclick: () => { view.cam.userAt = performance.now(); view.zoomBy(1.5); } }, '+'),
    h('button.small', { title: 'Zoom out (-)', 'aria-label': 'Zoom out', onclick: () => { view.cam.userAt = performance.now(); view.zoomBy(1 / 1.5); } }, '−'),
    h('button.small', { title: 'Fit whole field (F)', 'aria-label': 'Fit whole field', onclick: () => { view.cam.userAt = performance.now(); view.fit(); } }, '⤢'),
  );
  fieldwrap.append(hintEl, miniEl, infoEl, speedbar, zoomBar, rangeBar, overlayEl);

  const el = h('div.screen.match', null, topbar, h('div.mbody', null, fieldwrap, sideEl));
  // a button clicked with the mouse must not keep keyboard focus: Space / Enter would then re-press it (deselecting
  // the shop card, re-picking a speed) instead of deploying / pausing. Keyboard (Tab) focus keeps working as before.
  el.addEventListener('mousedown', (e) => {
    const b = (e.target as HTMLElement | null)?.closest('button');
    if (!b || b.getAttribute('role') === 'combobox') return;
    e.preventDefault();
    const a = document.activeElement;
    if (a instanceof HTMLElement && a !== b && el.contains(a) && a.tagName === 'BUTTON') a.blur();
  });

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
        st && st.squad > 1 ? h('span.card-squad', { title: `One purchase deploys a squad of ${st.squad} units` }, `×${st.squad}`) : null,
        h('div.name', null, d.name),
        (() => { const inf = infoOf(d); return inf ? h('div.card-roles', null,
          inf.gnd > 0 ? h('span.db-chip.gnd', { title: 'Hits ground units' }, 'GND') : null,
          inf.air > 0 ? h('span.db-chip.air', { title: 'Hits aircraft' }, 'AIR') : null) : null; })(),
        h('div.meta', null, h('span.cost', { title: st && st.squad > 1 ? `Block price: ${st.squad} units (≈${fmtUnitPrice(st.unitCost)} each)` : 'Supply price' }, st ? String(st.cost) : '?'), st && st.squad > 1 ? h('span.squad-badge', { title: `Squad of ${st.squad}` }, `×${st.squad}`) : null, h('span', null, st ? `${sizeLabel(st.size)}${st.flying ? ' · Air' : ''}` : 'invalid')),
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
  function hideTip() { tipEl?.remove(); tipEl = null; tipKey = ''; sheetOff?.(); sheetOff = null; ringHi = null; liveTip = null; }
  /** unit clicked during a battle replay: its stat card stays up with live hp / damage until you click elsewhere */
  let liveTip: { id: number; at: { x: number; y: number } } | null = null;
  let liveTipT = 0;
  function liveUnitAt(px: number, rawY: number): SimUnit | null {
    if (!battle) return null;
    // the drawn hull: the sim's oriented box (hullK x footprint, body-scaled) plus a finger margin; long hulls are hit
    // along their whole length. Tilted: a unit is drawn raised by its height (flyers by their altitude), so the
    // pointer is also read on the plane of its top.
    const probe = new Map<number, { x: number; y: number } | null>();
    const at = (rise: number) => {
      if (!probe.has(rise)) { try { probe.set(rise, view.screenToWorld(px, rawY + rise)); } catch { probe.set(rise, null); } }
      return probe.get(rise)!;
    };
    let best: SimUnit | null = null, bd = Infinity;
    for (const u of battle.units) {
      if (!u.alive) continue;
      const S = u.stats.size, hk = hullK(S), cs = Math.cos(u.angle), sn = Math.sin(u.angle);
      const tops = view.tilted ? [0, Math.round((u.flying ? flyHeight(S) : 0.6 * hullHeight(S)) * TILT_SIN * view.cam.k)] : [0];
      for (const rise of tops) {
        const w = at(rise);
        if (!w) continue;
        const dx = w.x - u.x, dy = w.y - u.y;
        const out = Math.hypot(Math.max(0, Math.abs(dx * cs + dy * sn) - hk * u.stats.fh), Math.max(0, Math.abs(dy * cs - dx * sn) - hk * u.stats.fw));
        const d = Math.hypot(dx, dy);
        if (out < 0.3 && d < bd) { bd = d; best = u; }
      }
    }
    return best;
  }
  /** live hp / damage of a clicked unit. The sim only tallies damage per block, so for a squad the hp is this one
   *  unit's (plus a squad hp / alive line) and the damage is labelled as the whole squad's. */
  function liveLine(u: SimUnit): HTMLElement {
    const dealt = battle ? Math.round(battle.blockDamage(u.side, u.uid)) : 0;
    const squad = u.stats.squad ?? 1;
    let alive = 0, hpSum = 0, hpMax = 0;
    if (squad > 1 && battle) for (const q of battle.units) {
      if (q.side !== u.side || q.uid !== u.uid) continue;
      hpMax += q.maxHp;
      if (q.alive) { alive++; hpSum += Math.max(0, q.hp); }
    }
    const fmt = (n: number) => Math.round(n).toLocaleString();
    return h('div.sc-dmg.sc-live', null,
      h('span', null, u.alive ? (squad > 1 ? 'This unit' : 'Now') : (squad > 1 ? 'Unit destroyed' : 'Destroyed')),
      u.alive ? h('b', null, `${Math.ceil(u.hp)} / ${Math.round(u.maxHp)} HP${u.shield > 0 ? ` · ${Math.ceil(u.shield)} shield` : ''}`) : null,
      u.alive && u.para > 0 ? h('em', { style: { color: '#9fe0ff' } }, u.stun > 0 ? `stunned ${u.stun.toFixed(1)}s` : `paralysis ${Math.round((100 * u.para) / u.maxHp)}%`) : null,
      squad > 1
        ? h('div.sc-live-sq', null,
          h('span', null, 'Squad'),
          h('b', null, `${alive}/${squad}`), h('small', null, ' alive · '),
          h('b', null, fmt(hpSum)), h('small', null, ` / ${fmt(hpMax)} HP`),
          h('em', null, `squad dealt ${dealt.toLocaleString()} this battle`))
        : h('em', null, `dealt ${dealt.toLocaleString()} this battle`));
  }
  function showLiveTip(u: SimUnit, at: { x: number; y: number }) {
    const mine = u.side === side;
    const bp = replay?.boards[u.side].find((q) => q.uid === u.uid); // the block's placement: real spacing / rotation
    const tip = tipFor(u.design, u.stats, u.level, mine ? 'Yours' : 'Enemy', mine, normSpacing(u.stats, bp?.spacing), false, liveLine(u), !!bp?.rot);
    mountTip(tip, false);
    tipKey = `live:${u.id}`;
    liveTip = { id: u.id, at };
    const er = el.getBoundingClientRect();
    const { w, h: ht } = tipSize;
    let left = at.x - er.left + 18, top = at.y - er.top + 18;
    if (left + w > er.width - 4) left = at.x - er.left - w - 18;
    if (top + ht > er.height - 4) top = at.y - er.top - ht - 18;
    tipEl!.style.left = `${Math.max(4, left)}px`;
    tipEl!.style.top = `${Math.max(4, top)}px`;
  }
  function refreshLiveTip(dt: number) {
    if (!liveTip || !tipEl || !battle) return;
    liveTipT += dt;
    if (liveTipT < 0.2) return;
    liveTipT = 0;
    const u = battle.units.find((q) => q.id === liveTip!.id);
    const old = tipEl.querySelector('.sc-live');
    if (u && old) old.replaceWith(liveLine(u));
  }
  /** block price; for a squad it buys all its units */
  /** `d` + `level` > 1: also the supply invested in the block (price + its upgrades), which is what it is worth */
  const costTag = (st: UnitStats, d?: Design, level = 1) => {
    const inv = d && level > 1 ? placementValue(d, level) : 0;
    return h('span.sc-cost', { title: `${st.squad > 1 ? `Block price: buys the whole squad of ${st.squad} units (≈${fmtUnitPrice(st.unitCost)} each)` : 'Supply price'}${inv ? ` · ${inv} invested with level ${level} upgrades` : ''}` },
      svgIcon('cost', 16), String(st.cost), st.squad > 1 ? h('small.sc-per', null, ` for ${st.squad}`) : null, inv ? h('small.sc-per', null, ` · ${inv} invested`) : null);
  };
  function tipFor(d: Design, st: UnitStats, level: number, tag: string, mine: boolean, spacing: number, interactive: boolean, dmg: HTMLElement | null = null, rot = false): HTMLElement {
    const lv = Math.max(1, Math.min(MAX_LEVEL, level));
    return h('div.stat-tip', { role: 'tooltip', class: mine ? 'friendly' : 'enemy' },
      h('div.sc-head', null,
        h('b.sc-name', null, d.name),
        h('span.stars', null, stars(lv)),
        h('span.sc-tag2', null, tag),
        costTag(st)),
      dmg,
      statCard({ design: d, st, level: lv, spacing, rot, onRing: interactive ? (k) => { ringHi = k; } : undefined }));
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
    mountTip(tipFor(d, st, 1, 'In shop', true, spacingOfCard(d), sheet, null, rotCard), sheet);
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
      // the same card as the pinned panel (minus its buttons): header, round damage, stats, parts
      const prev = h('canvas');
      const ups = lv - p.level;
      mountTip(h('div.stat-tip.unit-card', { role: 'tooltip', class: mine ? 'friendly' : 'enemy' },
        blockHead(t, p, d, st, lv, ups, prev),
        t.pending ? null : damageLine(t.side, t.uid),
        statCard({ design: d, st, level: lv, spacing: normSpacing(st, p.spacing), rot: !!p.rot, upgraded: ups > 0, onRing: sheet ? (k) => { ringHi = k; } : undefined }),
        blockParts(d)), sheet);
      requestAnimationFrame(() => paintPreview(prev, d, mine ? 0 : 1));
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
      const capped = deploying ? capBlock(d) : null;
      b.classList.toggle('capped', !!capped);
      if (capped) b.title = capped; else b.removeAttribute('title');
      b.disabled = !deploying || cost > rem || !statsOf(d) || !!capped;
      (b.querySelector('.count') as HTMLElement).textContent = n ? `+${n}` : '';
    });
  }

  function selectCard(i: number) {
    if (phase !== 'deploy') return;
    const d = deck()[i];
    if (!d) return;
    if (selCard === i) { selCard = -1; hover = null; sfx('click'); renderAll(); return; }
    if (costOf(d) > remaining()) { sfx('invalid'); app.toast(`Not enough supply for ${d.name}`, 'error'); return; }
    { const capped = capBlock(d); if (capped) { sfx('invalid'); app.toast(capped, 'error'); return; } }
    selCard = i;
    sel = null;
    multi = [];
    sfx('click');
    renderAll();
  }

  // ---------- top bar ----------
  const hpAt = (s: Side, throughRound: number) => hpAfterRound(m, s, throughRound);
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
    // during a replay/result the state already holds next round's supply; don't show it until deploy (or ever, once over)
    const replaying = phase === 'battle' || phase === 'result' || phase === 'over';
    supplyVal.textContent = replaying ? '—' : String(rem);
    supplyVal.classList.toggle('low', !replaying && rem < 0);
    const deploying = phase === 'deploy';
    undoBtn.disabled = !deploying || ops.length === 0;
    clearBtn.disabled = !deploying || (ops.length === 0 && cfg.size === 0);
    deployBtn.disabled = !deploying || submitting;
    deployBtn.textContent = submitting ? 'Deploying…' : 'Deploy & Fight';
    capEl.classList.toggle('hidden', replaying);
    if (!replaying) renderCaps();
    renderCards();
    renderShopSpacing();
  }

  function renderShopSpacing() {
    const d = phase === 'deploy' ? deck()[selCard] : undefined;
    if (!d) { shopSpacingEl.classList.add('hidden'); shopSpacingEl.replaceChildren(); return; }
    shopSpacingEl.classList.remove('hidden');
    const squad = hasSpacing(shapeOf(d));
    shopSpacingEl.replaceChildren(squad ? spacingControl(spacingOfCard(d), (v) => setCardSpacing(v), shapeOf(d), rotCard) : '');
    shopSpacingEl.classList.toggle('hidden', !squad);
  }

  function escortUi(sl: NonNullable<Sel>): EscortUi {
    const e = blockEscort(sl);
    const tp = e != null ? place.find((x) => x.uid === e) ?? myBoard().find((x) => x.uid === e) : undefined;
    return {
      label: e != null ? designOf(side, tp?.designId ?? '')?.name ?? `#${e}` : null,
      picking: escortPick?.uid === sl.uid && escortPick.pending === sl.pending,
      onPick: () => { escortPick = escortPick?.uid === sl.uid ? null : sl; renderAll(); },
      onClear: () => setBlockOrders(sl, { escort: -1 }),
    };
  }
  type OrdersPatch = Partial<Orders> & { escort?: number }; // escort -1 = clear
  const blockSrc = (sl: NonNullable<Sel>) => (sl.pending ? place.find((x) => x.uid === sl.uid) : boardOf(sl.side).find((x) => x.uid === sl.uid));
  /** the design's default kite / focus orders (what unset placement fields resolve to, as in the sim) */
  const defsOf = (s: Side, designId: string) => defaultOrders(designOf(s, designId));
  const blockOrders = (sl: NonNullable<Sel>): Orders | null => {
    const p = blockSrc(sl);
    if (!p) return null;
    const c = sl.pending ? undefined : cfg.get(p.uid);
    return ordersOf({ ...p, ...(c ?? {}) }, defsOf(sl.side, p.designId));
  };
  const blockEscort = (sl: NonNullable<Sel>): number | undefined => {
    const p = blockSrc(sl);
    if (!p) return undefined;
    const e = sl.pending ? p.escort : cfg.get(p.uid)?.escort ?? p.escort;
    return e != null && e >= 0 ? e : undefined;
  };
  let escortPick: NonNullable<Sel> | null = null;

  /** change battle orders of one of my blocks (pending: stored on the placement, locked: via `configure`) */
  function setBlockOrders(sl: NonNullable<Sel>, patch: OrdersPatch, quiet = false): string | null {
    if (phase !== 'deploy' || sl.side !== side) return null;
    const cur = blockOrders(sl);
    if (!cur) return null;
    const { escort: escPatch, ...op } = patch;
    const next: Orders = { ...cur, ...op };
    const esc = escPatch === undefined ? blockEscort(sl) : escPatch >= 0 ? escPatch : undefined;
    if (sl.pending) {
      const i = place.findIndex((x) => x.uid === sl.uid);
      if (i < 0) return null;
      const { target: _t, hold: _h, kite: _k, kiteMount: _km, focus: _f, stance: _s, delay: _d, retreat: _r, escort: _e, ...rest } = place[i];
      const np: Placement = { ...rest, ...orderFields({ ...next, hold: next.hold && hasSpacing(shapeOf(designOf(side, rest.designId))) }, defsOf(side, rest.designId)), ...(esc != null ? { escort: esc } : {}) };
      const cand = action();
      cand.place[i] = np;
      const err = check(cand);
      if (err) { if (!quiet) { sfx('invalid'); app.toast(err, 'error'); } return err; }
      place[i] = np;
    } else {
      const base = m.players[side].board.find((x) => x.uid === sl.uid);
      if (!base) return null;
      const prev = cfg.get(sl.uid);
      const entry: UnitConfig = { uid: sl.uid, ...next, escort: esc ?? -1 };
      const same = ordersEqual(next, ordersOf(base, defsOf(side, base.designId))) && (esc ?? -1) === (base.escort ?? -1);
      if (same) cfg.delete(sl.uid); else cfg.set(sl.uid, entry);
      const err = check(action());
      if (err) { if (prev) cfg.set(sl.uid, prev); else cfg.delete(sl.uid); if (!quiet) { sfx('invalid'); app.toast(err, 'error'); } return err; }
    }
    if (quiet) return null;
    sfx('click');
    renderAll();
    return null;
  }

  /** the same order change for every block of the group selection (squad-only orders skip single units) */
  function setGroupOrders(patch: OrdersPatch) {
    let ok = 0, err: string | null = null;
    for (const sl of multi) {
      const p = blockSrc(sl);
      const squad = p ? squadOf(designOf(sl.side, p.designId)) > 1 : false;
      const { hold, ...rest } = patch;
      const pp: OrdersPatch = hold !== undefined && squad ? { ...rest, hold } : rest;
      if (!Object.keys(pp).length) continue;
      const e = setBlockOrders(sl, pp, true);
      if (e) err = e; else ok++;
    }
    if (err) { sfx(ok ? 'click' : 'invalid'); app.toast(ok ? `Applied to ${ok} of ${multi.length} blocks: ${err}` : err, 'error'); }
    else sfx('click');
    renderAll();
  }

  function dropEscortsTo(uid: number) {
    place = place.map((p) => { if (p.escort !== uid) return p; const { escort: _e, ...r } = p; return r; });
    for (const [k, c] of cfg) if (c.escort === uid) { const b = m.players[side].board.find((x) => x.uid === k); if (b?.escort != null && b.escort >= 0) c.escort = -1; else cfg.delete(k); }
    for (const b of m.players[side].board) if (b.escort === uid && !cfg.has(b.uid)) cfg.set(b.uid, { uid: b.uid, ...ordersOf(b, defsOf(side, b.designId)), escort: -1 });
  }

  function setCardSpacing(v: number) {
    const d = deck()[selCard];
    if (!d || !hasSpacing(shapeOf(d))) return;
    lastSpacing.set(d.id, normSpacing(shapeOf(d), v));
    if (lastPtr) hover = computeHover(lastPtr.px, lastPtr.py);
    sfx('click');
    renderAll();
  }

  /** change spacing of a block placed this round; reverts (with a toast) if it would collide */
  function setPendingSpacing(uid: number, v: number) {
    const i = place.findIndex((p) => p.uid === uid);
    if (i < 0) return;
    const p = place[i];
    const shape = shapeOf(designOf(side, p.designId));
    if (!hasSpacing(shape)) return;
    const sp = normSpacing(shape, v);
    if (sp === normSpacing(shape, p.spacing)) return;
    const bd = blockDims(shape, sp, p.rot);
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
      if (!hasSpacing(shapeOf(d))) { app.toast('Only squads can be rotated'); return true; }
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
    const shape = shapeOf(dd);
    if (!hasSpacing(shape)) { app.toast('Only squads can be rotated'); return true; }
    const rot = !p.rot;
    const bd = blockDims(shape, p.spacing, rot);
    // turn about the block's centre, then nudge back inside the zone
    const old = blockDims(shape, p.spacing, p.rot);
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
    if (d && hasSpacing(shapeOf(d))) { setCardSpacing(Math.max(0, Math.min(MAX_SPACING, spacingOfCard(d) + dir))); return true; }
    if (sel?.pending && sel.side === side) {
      const p = place.find((x) => x.uid === sel!.uid);
      if (p && hasSpacing(shapeOf(designOf(side, p.designId)))) { setPendingSpacing(p.uid, Math.max(0, Math.min(MAX_SPACING, normSpacing(shapeOf(designOf(side, p.designId)), p.spacing) + dir))); return true; }
    }
    return false;
  }

  function renderHint() {
    let t = '';
    if (phase === 'deploy' && escortPick) t = 'Click a friendly block to escort · Esc to cancel';
    else if (phase === 'deploy') {
      const d = deck()[selCard];
      if (d) t = hover && !hover.valid && hover.reason ? hover.reason : `Place ${d.name}${squadOf(d) > 1 ? ' squad' : ''} in your zone${hasSpacing(shapeOf(d)) ? ' · [ ] spacing · R rotate' : ''} · Esc to cancel`;
      else if (multi.length >= 2) t = `${multi.length} blocks selected · Shift+click to add/remove · Esc to clear`;
      else t = place.length || myBoard().length ? (boxMode ? 'Drag a box over your blocks to select them together · turn off Box select to pan' : window.matchMedia('(hover: none)').matches ? 'Tap a block to adjust it · Box select picks several to set their orders together' : 'Click a block to adjust it · drag a box over several to set their orders together · right-drag to pan') : 'Pick a unit card, then tap your zone to deploy';
    } else if (phase === 'battle') t = 'Battle in progress';
    hintEl.textContent = t;
    hintEl.classList.toggle('hidden', !t);
    const cd = phase === 'deploy' && !escortPick ? deck()[selCard] : undefined;
    const cst = cd && statsOf(cd);
    if (cd && cst) miniEl.replaceChildren(miniStats(cd, cst)); else miniEl.replaceChildren();
    miniEl.classList.toggle('hidden', !cst);
  }

  function renderSpeed() {
    speedBtns.forEach((b, i) => b.classList.toggle('active', !paused && BATTLE_SPEEDS[i] === speed));
    if (phase !== 'battle') paused = false;
    pauseBtn.classList.toggle('active', paused);
    fieldwrap.classList.toggle('paused', paused);
    pauseBtn.textContent = paused ? '▶' : '❚❚';
    pauseBtn.setAttribute('aria-label', paused ? 'Resume' : 'Pause');
    speedbar.classList.toggle('hidden', phase !== 'battle');
    rangeBar.classList.toggle('hidden', phase !== 'deploy' && phase !== 'waiting');
    selBtn.classList.toggle('hidden', phase !== 'deploy');
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
        h('div.sc-sub', null, 'Placing · ', costTag(st))),
      ),
      statCard({ design: d, st, level: 1, spacing: spacingOfCard(d), rot: rotCard, onRing: onRingHi }),
    );
    infoEl.classList.remove('hidden');
    infoEl.classList.remove('picking');
    requestAnimationFrame(() => paintPreview(prev, d, 0));
    return true;
  }
  function renderGroupInfo() {
    hideTip();
    const lead = multi[0];
    const o = blockOrders(lead)!;
    const isSquad = (sl: NonNullable<Sel>) => { const p = blockSrc(sl); return !!p && squadOf(designOf(sl.side, p.designId)) > 1; };
    const anySquad = multi.some(isSquad);
    // orders the blocks disagree on show as mixed (Keep spread: among the squads only, single units have none)
    const mixed = new Set<keyof Orders>();
    for (const k of ['target', 'focus', 'stance', 'kite', 'hold', 'delay', 'retreat'] as const) {
      const vals = new Set(multi.filter((sl) => k !== 'hold' || isSquad(sl)).map((sl) => blockOrders(sl)?.[k]));
      if (vals.size > 1) mixed.add(k);
    }
    if (anySquad && !mixed.has('hold')) o.hold = !!blockOrders(multi.find(isSquad)!)?.hold;
    const counts = new Map<string, number>();
    for (const sl of multi) { const p = blockSrc(sl); const n = (p && designOf(sl.side, p.designId)?.name) ?? '?'; counts.set(n, (counts.get(n) ?? 0) + 1); }
    infoEl.replaceChildren(
      h('button.icon.small.ghost.close', { onclick: () => { multi = []; renderAll(); } }, '✕'),
      h('div.head', null, h('div', null,
        h('h3', { class: 'friendly' }, `${multi.length} blocks selected`),
        h('div.sc-sub', null, [...counts].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join(' · ')),
      )),
      h('p.muted', { style: { margin: '4px 0 0', fontSize: '0.85rem' } }, mixed.size ? 'Order changes apply to every selected block (half-lit / Mixed: the blocks differ).' : 'Order changes apply to every selected block.'),
      h('div.info-spacing', null, ordersControl(o, anySquad, (patch) => setGroupOrders(patch), { custom: false, mixed })),
    );
    infoEl.classList.remove('hidden');
    infoEl.classList.remove('picking');
  }

  /** header shared by the hover card and the pinned panel of a block on the field: portrait, name, level, status */
  function blockHead(s: NonNullable<Sel>, p: Placement, d: Design, st: UnitStats, lv: number, ups: number, prev: HTMLCanvasElement): HTMLElement {
    const mine = s.side === side;
    return h('div.head', null, prev, h('div', null,
      h('h3', { class: mine ? 'friendly' : 'enemy' }, d.name),
      h('div.stars', null, stars(lv), ups ? h('span.good', { style: { fontSize: '0.85rem', marginLeft: '6px' } }, `+${ups} pending`) : null),
      h('div.sc-sub', null, `${mine ? (s.pending ? 'New this round' : `Deployed round ${p.round}`) : 'Enemy unit'} · `, costTag(st, d, lv)),
    ));
  }
  const blockParts = (d: Design) => h('div.parts', null, [CHASSIS_BY_ID.get(d.chassis)?.name, MOBILITY_BY_ID.get(d.mobility)?.name].filter(Boolean).join(' · '));

  function renderInfo() {
    multi = multi.filter((sl) => !!blockSrc(sl));
    if (multi.length >= 2 && phase === 'deploy') { renderGroupInfo(); return; }
    if (multi.length < 2 || phase !== 'deploy') multi = [];
    if (!sel || (phase !== 'deploy' && phase !== 'waiting')) {
      if (!renderCardPreview()) { infoEl.classList.add('hidden'); ringHi = null; }
      return;
    }
    const s = sel;
    const p = s.pending ? place.find((x) => x.uid === s.uid) : boardOf(s.side).find((x) => x.uid === s.uid);
    const d = p && designOf(s.side, p.designId);
    const st = d && statsOf(d);
    if (!p || !d || !st) { sel = null; infoEl.classList.add('hidden'); return; }
    hideTip();
    const mine = s.side === side;
    const ups = mine && !s.pending ? pendingUps(p.uid) : 0;
    const lv = p.level + ups;
    const squad = st.squad ?? 1;
    const sp = normSpacing(st, p.spacing);
    const prev = h('canvas');
    const actions: HTMLElement[] = [];
    if (mine && phase === 'deploy') {
      if (s.pending) {
        if (hasSpacing(st)) actions.push(h('button.small', { title: 'Turn the formation 90° (R)', onclick: () => rotateBlock() }, '⟳ Rotate'));
        actions.push(h('button.small.danger', { onclick: () => removePending(p.uid) }, 'Remove (refund)'));
      } else {
        if (lv < MAX_LEVEL) {
          let cost = 0;
          try { cost = upgradeCost(d, lv); } catch { /* */ }
          const cand = action();
          cand.upgrade.push(p.uid);
          const err = cost > remaining() ? 'Not enough supply' : check(cand);
          const what = squad > 1 ? `all ${squad} units of this squad` : 'this unit';
          actions.push(h('button.small.warn', { onclick: () => upgrade(p.uid), disabled: !!err, title: err ?? `Level ${lv + 1}: ${what} get +${Math.round(LEVEL_BONUS * 100)}% HP and damage` }, `Upgrade${squad > 1 ? ' squad' : ''} · ${cost}`));
        } else actions.push(h('button.small', { disabled: true }, 'Max level'));
        if (ups) actions.push(h('button.small', { onclick: () => undoUpgrade(p.uid) }, 'Undo upgrade'));
        const back = sellValue(d, p.level);
        actions.push(h('button.small.danger', { onclick: () => sellBlock(p.uid), title: `Sell for ${Math.round(SELL_REFUND * 100)}% of the ${placementValue(d, p.level)} supply spent on it (purchase + upgrades)` }, `Sell · +${back}`));
      }
    }
    infoEl.replaceChildren(
      h('button.icon.small.ghost.close', { onclick: () => { sel = null; renderAll(); } }, '✕'),
      blockHead(s, p, d, st, lv, ups, prev),
      s.pending ? '' : (ensureLastDamage(), damageLine(s.side, s.uid) ?? ''),
      statCard({ design: d, st, level: lv, spacing: sp, rot: !!p.rot, upgraded: ups > 0, onRing: onRingHi }),
      mine && blockOrders(s) ? h('div.info-spacing', null, ordersControl(blockOrders(s)!, squad > 1, (patch) => { if (phase === 'deploy') setBlockOrders(s, patch); }, phase === 'deploy' ? { escort: escortUi(s), kiteOptions: kiteOptions(designOf(s.side, p.designId)), defaults: defsOf(s.side, p.designId) } : { defaults: defsOf(s.side, p.designId) })) : '',
      squad > 1 ? h('div.info-spacing', null, spacingControl(sp, mine && phase === 'deploy' && s.pending ? (v) => setPendingSpacing(p.uid, v) : null, shapeOf(d), !!p.rot)) : '',
      blockParts(d),
      actions.length ? h('div.actions', null, ...actions) : '',
    );
    infoEl.classList.remove('hidden');
    infoEl.classList.toggle('picking', !!escortPick);
    requestAnimationFrame(() => paintPreview(prev, d, mine ? 0 : 1));
  }

  // ---------- overlays (waiting / result / game over) ----------
  /** " · 23/40 units" from the finished replay (squads count each unit) when it differs from the block count */
  function unitsLeft(sd: Side): HTMLElement | null {
    if (!battle || !replay || !battle.done) return null;
    let alive = 0, total = 0;
    for (const u of battle.units) if (u.side === sd) { total++; if (u.alive) alive++; }
    return total !== replay.boards[sd].length ? h('small.muted', null, ` · ${alive}/${total} units`) : null;
  }
  function fieldedUnits(): HTMLElement | null {
    const n = me().board.reduce((a, p) => a + squadOf(designOf(side, p.designId)), 0);
    return n !== me().board.length ? h('small.muted', null, ` · ${n} units`) : null;
  }
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
          h('span', { title: 'Blocks with at least one unit left (a squad block counts once)' }, 'Your blocks left'), h('b', null, `${r.survivors[side].length} / ${replay.boards[side].length}`, unitsLeft(side)),
          h('span', { title: 'Blocks with at least one unit left (a squad block counts once)' }, 'Enemy blocks left'), h('b', null, `${r.survivors[opp].length} / ${replay.boards[opp].length}`, unitsLeft(opp)),
        ),
        h('div.actions', null, cont),
      ));
      setTimeout(() => cont.focus({ preventScroll: true }), 50);
    } else if (phase === 'over') {
      const won = m.winner === side, lost = m.winner === opp;
      const roundsWon = m.history.filter((r) => r.result.winner === side).length;
      const dealt = totalDamageTaken(m, opp);
      const taken = totalDamageTaken(m, side);
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
          h('span', { title: 'Blocks on your board at the end (a squad block counts once)' }, 'Blocks fielded'), h('b', null, String(me().board.length), fieldedUnits()),
          h('span', null, 'Final HP'), h('b', null, `${Math.max(0, me().hp)} – ${Math.max(0, foe().hp)}`),
        ),
        h('div.actions', null, ...buttons),
      ));
    }
  }

  function renderAll() {
    // the info panel is rebuilt: keyboard focus on one of its controls moves to the control's replacement
    const ae = document.activeElement as HTMLElement | null;
    const fk = ae && infoEl.contains(ae) ? ae.getAttribute('data-fk') : null;
    renderTop();
    renderSide();
    renderHint();
    renderInfo();
    renderSpeed();
    if (fk && !infoEl.contains(document.activeElement)) {
      infoEl.querySelector<HTMLElement>(`[data-fk="${fk}"]`)?.focus({ preventScroll: true });
    }
  }

  // ---------- deploy actions ----------
  const newOrders = (designId: string, shape: BlockShape) => { const defs = defsOf(side, designId); const o = ordersOf(designOf(side, designId)?.behavior, defs); return orderFields({ ...o, hold: hasSpacing(shape) && o.hold }, defs); };

  function computeHover(px: number, py: number): typeof hover {
    const d = deck()[selCard];
    if (!d) return null;
    const shape = shapeOf(d);
    const spacing = spacingOfCard(d);
    const rot = rotCard && hasSpacing(shape);
    const { w: bw, h: bh } = blockDims(shape, spacing, rot);
    let wp: { x: number; y: number };
    try { wp = view.screenToWorld(px, py); } catch { return null; }
    const col = Math.round(wp.x - bw / 2), row = Math.round(wp.y - bh / 2);
    let { x, y } = worldToLocalRect(side, col, row, bw, bh);
    if (y > DEPLOY_D + 2 || y < -bh - 1 || x < -bw - 1 || x > DEPLOY_W + 1) return null; // far outside our zone
    x = Math.max(0, Math.min(DEPLOY_W - bw, x));
    y = Math.max(0, Math.min(DEPLOY_D - bh, y));
    let reason: string | null = null;
    if (!blockInZone(x, y, shape, spacing, rot)) reason = 'Outside your deploy zone';
    else if (costOf(d) > remaining()) reason = 'Not enough supply';
    else {
      const cand = action();
      cand.place.push({ uid: nextUid, designId: d.id, x, y, level: 1, round: m.round, ...(hasSpacing(shape) ? { spacing } : {}), ...(rot ? { rot: true } : {}), ...newOrders(d.id, shape) });
      reason = check(cand);
    }
    return { x, y, shape, spacing, rot, w: bw, h: bh, valid: !reason, reason };
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
    place.push({ uid, designId: d.id, x: hover.x, y: hover.y, level: 1, round: m.round, ...(hasSpacing(hover.shape) ? { spacing: hover.spacing } : {}), ...(hover.rot ? { rot: true } : {}), ...newOrders(d.id, hover.shape) });
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

  /** sell a unit from an earlier round (refund applies this turn; undo brings it back) */
  function sellBlock(uid: number) {
    const u = me().board.find((b) => b.uid === uid);
    const d = u && designOf(side, u.designId);
    if (!u || !d || sold.includes(uid)) return;
    const cand = action();
    cand.upgrade = cand.upgrade.filter((x) => x !== uid);
    cand.configure = cand.configure?.filter((c) => c.uid !== uid);
    cand.sell = [...(cand.sell ?? []), uid];
    const err = check(cand);
    if (err) { sfx('invalid'); app.toast(err, 'error'); return; }
    upgrades = upgrades.filter((x) => x !== uid);
    ops = ops.filter((o) => !(o.kind === 'upgrade' && o.uid === uid));
    cfg.delete(uid);
    sold.push(uid);
    ops.push({ kind: 'sell', uid });
    dropEscortsTo(uid);
    if (sel && !sel.pending && sel.uid === uid) sel = null;
    multi = multi.filter((x) => x.pending || x.uid !== uid);
    sfx('click');
    app.toast(`Sold ${d.name} for ${sellValue(d, u.level)} supply (Undo brings it back)`, 'info');
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
    else if (o.kind === 'sell') sold = sold.filter((x) => x !== o.uid);
    else { const i = upgrades.lastIndexOf(o.uid); if (i >= 0) upgrades.splice(i, 1); }
    sfx('click');
    renderAll();
  }

  function clearAll() {
    cfg.clear();
    place = [];
    upgrades = [];
    sold = [];
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
    if (!a.place.length && !a.upgrade.length && !a.sell?.length) {
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
    multi = [];
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
      const r = blockWorldRect(s, p, shapeOf(designOf(s, p.designId)));
      return w.x >= r.col && w.x <= r.col + r.w && w.y >= r.row && w.y <= r.row + r.h;
    };
    if (phase === 'deploy') for (const p of place) if (hit(side, p)) return { side, uid: p.uid, pending: true };
    for (const p of myBoard()) if (hit(side, p)) return { side, uid: p.uid, pending: false };
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
    const shape = shapeOf(d);
    const { w: bw, h: bh } = blockDims(shape, p.spacing, p.rot);
    let wp: { x: number; y: number };
    try { wp = view.screenToWorld(px, py); } catch { return; }
    let { x, y } = worldToLocalRect(side, Math.round(wp.x - moveDrag.offX), Math.round(wp.y - moveDrag.offY), bw, bh);
    x = Math.max(0, Math.min(DEPLOY_W - bw, x));
    y = Math.max(0, Math.min(DEPLOY_D - bh, y));
    if (x === p.x && y === p.y && moveDrag.started) return;
    p.x = x; p.y = y;
    moveDrag.reason = !blockInZone(x, y, shape, p.spacing, p.rot) ? 'Outside your deploy zone' : check(action());
    hover = { x, y, shape, spacing: p.spacing ?? 0, rot: p.rot, w: bw, h: bh, valid: !moveDrag.reason, reason: moveDrag.reason };
    renderHint();
  }

  /** Shift+drag on the field (deploy, no card picked): rubber-band selection of my blocks, canvas CSS px */
  /** add: Shift / Box-select mode (a click toggles one block in the group); else a plain drag (a click is a click) */
  let boxSel: { x0: number; y0: number; x1: number; y1: number; add: boolean } | null = null;
  function drawBox() {
    if (!boxSel) { boxEl.classList.add('hidden'); return; }
    const l = Math.min(boxSel.x0, boxSel.x1), t = Math.min(boxSel.y0, boxSel.y1);
    Object.assign(boxEl.style, { left: `${l}px`, top: `${t}px`, width: `${Math.abs(boxSel.x1 - boxSel.x0)}px`, height: `${Math.abs(boxSel.y1 - boxSel.y0)}px` });
    boxEl.classList.remove('hidden');
  }
  /** my blocks whose footprint centre falls inside the box */
  function blocksInBox(b: NonNullable<typeof boxSel>): NonNullable<Sel>[] {
    const l = Math.min(b.x0, b.x1), r = Math.max(b.x0, b.x1), t = Math.min(b.y0, b.y1), bt = Math.max(b.y0, b.y1);
    const out: NonNullable<Sel>[] = [];
    const test = (p: Placement, pending: boolean) => {
      const d = designOf(side, p.designId);
      const wr = blockWorldRect(side, p, shapeOf(d));
      let sp: { x: number; y: number };
      try { sp = view.worldToScreen(wr.col + wr.w / 2, wr.row + wr.h / 2); } catch { return; }
      if (sp.x >= l && sp.x <= r && sp.y >= t && sp.y <= bt) out.push({ side, uid: p.uid, pending });
    };
    for (const p of myBoard()) test(p, false);
    for (const p of place) test(p, true);
    return out;
  }
  /** make `list` the selection: one block = normal single selection, more = group */
  function selectBlocks(list: NonNullable<Sel>[]) {
    if (list.length === 1) { sel = list[0]; multi = []; } else { sel = null; multi = list; }
    if (list.length) sfx('click');
    renderAll();
  }

  canvas.addEventListener('pointerdown', (e) => {
    downAt = { x: e.clientX, y: e.clientY };
    lpDone = false;
    clearTimeout(lpTimer);
    moveDrag = null;
    // box select: Shift / Box-select mode always; with a mouse, any left-drag that starts off your new blocks (those
    // drag-move). A click without dragging still selects normally (see pointerup). Right/middle-drag pans.
    if (phase === 'deploy' && selCard < 0 && !escortPick && e.button === 0
      && (e.shiftKey || boxMode || (e.pointerType === 'mouse' && !myPendingAt(local(e).px, local(e).rawY)))) {
      const { px, rawY } = local(e);
      boxSel = { x0: px, y0: rawY, x1: px, y1: rawY, add: e.shiftKey || boxMode };
      view.controls.enabled = false; // this gesture draws the selection box, not a camera pan
      try { canvas.setPointerCapture(e.pointerId); } catch { /* */ }
      return;
    }
    if (phase === 'deploy' && selCard < 0 && !escortPick && e.button === 0) {
      const { px, rawY } = local(e);
      const p = myPendingAt(px, rawY);
      const d = p && designOf(side, p.designId);
      if (p && d) {
        let wp: { x: number; y: number } | null = null;
        try { wp = view.screenToWorld(px, rawY); } catch { /* */ }
        if (wp) {
          const r = blockWorldRect(side, p, shapeOf(d));
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
    if (boxSel) { boxSel.x1 = lp.px; boxSel.y1 = lp.rawY; drawBox(); return; }
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
      else if (tipKey && !liveTip) hideTip();
    }
    if (phase !== 'deploy' || selCard < 0) return;
    if (e.pointerType === 'touch' && !downAt) return;
    const { px, py } = local(e);
    const prev = hover;
    hover = computeHover(px, py);
    if (prev?.x !== hover?.x || prev?.y !== hover?.y || prev?.valid !== hover?.valid) renderHint();
  });
  canvas.addEventListener('pointerleave', (e) => {
    // a unit pinned mid-battle stays up when the pointer heads for the speed bar or the tip itself
    if (e.pointerType === 'mouse') { hover = null; hoverUnit = null; lastPtr = null; if (tipKey && !liveTip) hideTip(); renderHint(); }
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
      const tiny = Math.abs(b.x1 - b.x0) < 6 && Math.abs(b.y1 - b.y0) < 6;
      if (tiny && !b.add) {
        // a plain click, not a drag: fall through to the normal click handling below
      } else if (tiny) {
        // shift-click: add / remove one of my blocks to the group
        const hit = unitAt(b.x0, b.y0);
        if (!hit || hit.side !== side) return;
        const cur = multi.length ? multi : sel && sel.side === side ? [sel] : [];
        const has = cur.some((x) => x.uid === hit.uid && x.pending === hit.pending);
        selectBlocks(has ? cur.filter((x) => !(x.uid === hit.uid && x.pending === hit.pending)) : [...cur, hit]);
        return;
      } else {
        selectBlocks(blocksInBox(b));
        return;
      }
    }
    if (endMove(true)) return; // a drag-move, not a click
    if (lpDone) { lpDone = false; return; }
    if (!start || e.button > 0) return;
    if (view.wasDrag) { // end of a pan / pinch: not a click or tap
      if (e.pointerType === 'touch') { hover = null; renderHint(); }
      return;
    }
    if (phase === 'battle' || phase === 'result' || phase === 'over') {
      // battle: click a unit to pin its stats (live hp + damage), click empty ground to close
      const lp = local(e);
      const u = liveUnitAt(lp.px, lp.rawY);
      if (u) { showLiveTip(u, { x: e.clientX, y: e.clientY }); sfx('click'); } else if (tipKey) hideTip();
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
    if (e.key >= '1' && e.key <= '9' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const i = visibleCards[Number(e.key) - 1];
      if (i !== undefined) selectCard(i);
      e.preventDefault();
    } else if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (rotateBlock()) e.preventDefault();
    } else if ((e.key === '[' || e.key === ']') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (stepSpacing(e.key === ']' ? 1 : -1)) e.preventDefault();
    } else if ((e.key === 'p' || e.key === 'P') && phase === 'battle' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      togglePause();
    } else if (e.key === 'Escape') {
      if (tipEl?.classList.contains('sheet') || liveTip) { hideTip(); return; }
      if (escortPick) escortPick = null;
      else if (selCard >= 0) { selCard = -1; hover = null; }
      else { sel = null; multi = []; }
      renderAll();
    } else if (e.key === ' ' || e.key === 'Enter') {
      if (t && t.tagName === 'BUTTON') return; // let the focused button / kit control handle it
      e.preventDefault();
      if (phase === 'deploy') void submit();
      else if (phase === 'battle') { if (e.key === ' ') togglePause(); else skipBattle(); }
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
    const can = (d && hasSpacing(shapeOf(d))) || (sel?.pending && sel.side === side);
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
    // a shop-card / block tooltip belongs to the phase it was opened in (disabled cards never get pointerleave);
    // a unit pinned mid-battle may stay up through the result
    if (p !== prev && (!liveTip || p === 'deploy' || p === 'waiting')) hideTip();
    if (p === 'waiting' && prev !== 'waiting' && m.history.length && lastDmg?.round !== m.history[m.history.length - 1].round) setTimeout(ensureLastDamage, 600);
    if (p === 'deploy' && prev !== 'deploy') {
      playMusic('deploy');
      try { view.frameDeploy(); } catch { /* */ }
      // resumed mid-match: rebuild last round's damage tally off the critical path
      if (m.history.length && lastDmg?.round !== m.history[m.history.length - 1].round) setTimeout(ensureLastDamage, 600);
    }
    if (p === 'battle' && prev !== 'battle') { try { view.fit(); } catch { /* */ } autoCam = { on: loadSettings().autoCam !== false, since: view.cam.userAt, box: null }; }
    if (p !== 'deploy' && p !== 'waiting') clearRings();
    renderAll();
    renderOverlay();
  }

  function evaluate() {
    if (phase === 'battle' || phase === 'result') return;
    // also remember it here: with storage blocked lastWatched() stays 0 and the round would replay forever
    const lw = Math.max(lastWatched(m.id), watchedHere);
    const rec = m.history.find((r) => r.round > lw);
    if (rec) { startReplay(rec); return; }
    if (m.status === 'done') { showOver(); return; }
    if (pendingRound !== m.round) resetPending();
    else if (me().ready && (ops.length || cfg.size)) { cfg.clear(); place = []; upgrades = []; sold = []; ops = []; selCard = -1; hover = null; sel = null; multi = []; } // submitted: now on the board
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
    watchedHere = Math.max(watchedHere, replay.round);
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
      for (const c of placementUnitCenters(s, p, shapeOf(d))) out.push({ side: s, design: d, x: c.x, y: c.y, level: p.level, ...extra });
    };
    for (const p of foe().board) add(opp, p, { selected: sel?.side === opp && sel.uid === p.uid });
    for (const p of myBoard()) add(side, p, { level: Math.min(MAX_LEVEL, p.level + pendingUps(p.uid)), selected: (sel?.side === side && !sel.pending && sel.uid === p.uid) || inMulti(side, p.uid, false) });
    if (phase === 'deploy') {
      for (const p of place) add(side, p, { selected: (!!sel?.pending && sel.uid === p.uid) || inMulti(side, p.uid, true) });
      const d = deck()[selCard];
      if (hover && d) {
        for (const c of placementUnitCenters(side, { x: hover.x, y: hover.y, spacing: hover.spacing, rot: hover.rot }, hover.shape)) {
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
    const p = t.pending ? place.find((x) => x.uid === t.uid) : boardOf(t.side).find((x) => x.uid === t.uid);
    const d = p && designOf(t.side, p.designId);
    if (!p || !d) return null;
    const r = blockWorldRect(t.side, p, shapeOf(d));
    return { col: r.col, row: r.row, size: Math.max(r.w, r.h), w: r.w, h: r.h, valid: t.side === side };
  }

  // ---------- range rings overlay ----------
  interface RingTarget { side: Side; design: Design; st: UnitStats; pos: Pick<Placement, 'x' | 'y'> & { spacing?: number; rot?: boolean }; strong: boolean; invalid?: boolean }
  const ringCtx = ringCv.getContext('2d');
  let ringW = 0, ringH = 0, ringDpr = 1, ringsShown = false;
  function clearRings() {
    if (!ringCtx || !ringsShown) return;
    // Reset the backing store instead of clearRect: Chrome was seen skipping a lone clearRect on this canvas when
    // nothing had been drawn since the last frame (the deploy rings then stayed up through the whole battle).
    // Assigning width always drops the bitmap (and the context state).
    ringCv.width = ringCv.width;
    ringCv.style.visibility = 'hidden'; // and hide the layer, belt and braces (seen under GPU load with 3D)
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
      out.push({ side: s, design: d, st, pos: p, strong, invalid });
    };
    const keyOf = (s: Side, uid: number) => `${s}:${uid}`;
    if (phase === 'deploy' && hover && selCard >= 0) push(side, { x: hover.x, y: hover.y, spacing: hover.spacing, rot: hover.rot }, deck()[selCard], true, 'ghost', !hover.valid);
    for (const t of [sel, hoverUnit]) {
      if (!t) continue;
      const p = blockSrc(t);
      if (p) push(t.side, p, designOf(t.side, p.designId), true, keyOf(t.side, t.uid));
    }
    if (showMine || shiftDown) {
      for (const p of myBoard()) push(side, p, designOf(side, p.designId), false, keyOf(side, p.uid));
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
    const targets = rangeTargets();
    if (!targets.length) { clearRings(); return; }
    if (ringsShown) ringCv.width = ringCv.width; // full reset (see clearRings)
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    ringsShown = true;
    ringCv.style.visibility = '';
    legendEl.classList.remove('hidden');
    const taken: { x: number; y: number; w: number; h: number }[] = [];
    // weak (all-units) rings first so the focused block's rings sit on top
    for (const t of [...targets].sort((a, b) => Number(a.strong) - Number(b.strong))) {
      const worldCenters = placementUnitCenters(t.side, t.pos, t.st);
      // local ground scale at this block (the 3D perspective camera draws nearer ground larger)
      const sc = view.scaleAt(worldCenters[0]?.x ?? 0, worldCenters[0]?.y ?? 0);
      const k = sc.k;
      // units deploy facing the enemy; ranges are measured from each weapon's own mount (same offsets as the sim)
      const bs = bodyScale(t.st.size), offs = mountOffsets(t.design).map((o) => ({ x: o.x * bs, y: o.y * bs }));
      const head = forwardY(t.side) < 0 ? -Math.PI / 2 : Math.PI / 2, hc = Math.cos(head), hs = Math.sin(head);
      let x0 = 0, y0 = 0, x1 = 0, y1 = 0;
      const frame = (mounts: number[] | null) => {
        x0 = Infinity; y0 = Infinity; x1 = -Infinity; y1 = -Infinity;
        for (const c of worldCenters) {
          for (const m of mounts ?? [-1]) {
            const o = m >= 0 ? offs[m] : undefined;
            const wx = c.x + (o ? hc * o.x - hs * o.y : 0), wy = c.y + (o ? hs * o.x + hc * o.y : 0);
            const sp = view.worldToScreen(wx, wy);
            x0 = Math.min(x0, sp.x); y0 = Math.min(y0, sp.y); x1 = Math.max(x1, sp.x); y1 = Math.max(y1, sp.y);
          }
        }
      };
      const rings = ringsOf(t.design, t.st).sort((a, b) => b.range - a.range);
      // the ring lives on the ground plane (foreshortened by the camera tilt): a circle around the mount for one unit,
      // the rounded outline of all its circles for a squad
      const ay = sc.ay;
      let uh = 0;
      let cur = new Path2D();
      const path = (r: number) => {
        const base = new Path2D();
        base.roundRect(x0 - r, y0 - r, x1 - x0 + 2 * r, uh + 2 * r, r);
        cur = new Path2D();
        cur.addPath(base, new DOMMatrix([1, 0, 0, ay, 0, y0 * (1 - ay)]));
      };
      const angles = [-90, -62, -118, -34, -146, -10, -170].map((a) => (a * Math.PI) / 180);
      rings.forEach((rg, i) => {
        frame(rg.melee ? null : rg.mounts);
        uh = (y1 - y0) / ay;
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
      if (p && d) cx = view.worldToScreen(...(Object.values(blockWorldRectCenter(sel.side, p, shapeOf(d))) as [number, number])).x;
    } else if (hover) {
      const r = blockWorldRect(side, { x: hover.x, y: hover.y, spacing: hover.spacing, rot: hover.rot }, hover.shape);
      cx = view.worldToScreen(r.col + r.w / 2, r.row + r.h / 2).x;
    }
    if (cx == null) return;
    const W = canvas.clientWidth;
    if (cx < 390) infoEl.classList.add('right');
    else if (cx > W - 450) infoEl.classList.remove('right');
  }
  const blockWorldRectCenter = (s: Side, p: Placement, shape: BlockShape) => { const r = blockWorldRect(s, p, shape); return { x: r.col + r.w / 2, y: r.row + r.h / 2 }; };

  let raf = 0;
  let last = performance.now();
  let drawErr = false;
  /** Auto camera for the battle replay: frames every living unit (zooming in as the fight thins out) until the
   *  player moves the camera themselves (Camera.userAt changes); back on at the next battle. `box` is the eased
   *  bounding box (world cells), so the framing glides instead of jumping when a unit dies or a jet loops away. */
  let autoCam: { on: boolean; since: number; box: [number, number, number, number] | null } = { on: false, since: 0, box: null };
  function updateAutoCam(b: Battle, dt: number) {
    if (!autoCam.on) return;
    if (view.cam.userAt > autoCam.since) { autoCam.on = false; return; }
    // where most of the units are: with 8+ alive, the outer 8% on each axis (stragglers, jets looping wide) is
    // left out so one far unit doesn't hold the whole field in view
    const xs: number[] = [], ys: number[] = [];
    for (const u of b.units) if (u.alive) { xs.push(u.x); ys.push(u.y); }
    if (!xs.length) return;
    xs.sort((p, q) => p - q); ys.sort((p, q) => p - q);
    const cut = xs.length >= 8 ? Math.floor(xs.length * 0.08) : 0, hiI = xs.length - 1 - cut;
    const x0 = xs[cut], x1 = xs[hiI], y0 = ys[cut], y1 = ys[hiI];
    const bx = autoCam.box;
    if (!bx) autoCam.box = [x0, y0, x1, y1];
    else {
      // ease toward the live box: grows a little faster than it shrinks so units rarely leave the frame
      const ease = (cur: number, want: number, out: boolean) => cur + (want - cur) * Math.min(1, dt * (out ? 2.2 : 0.9));
      bx[0] = ease(bx[0], x0, x0 < bx[0]); bx[1] = ease(bx[1], y0, y0 < bx[1]);
      bx[2] = ease(bx[2], x1, x1 > bx[2]); bx[3] = ease(bx[3], y1, y1 > bx[3]);
    }
    const f = autoCam.box!;
    view.frameWorldBox(f[0], f[1], f[2], f[3]);
  }
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    view.controls.doubleClickZoom = phase !== 'deploy' || (selCard < 0 && !sel);
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    try {
      if ((phase === 'battle' || phase === 'result' || phase === 'over') && battle) {
        if (phase === 'battle') {
          if (!paused) acc += dt * TICK_RATE * speed;
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
        clearRings(); // first: a slow (3D) or throwing drawBattle must not leave deploy rings up
        if (phase === 'battle') updateAutoCam(battle, dt);
        view.drawBattle(battle, dt);
        refreshLiveTip(dt);
      } else {
        let hov: BoardOverlay['hover'] = null;
        if (hover && phase === 'deploy') {
          const r = blockWorldRect(side, { x: hover.x, y: hover.y, spacing: hover.spacing, rot: hover.rot }, hover.shape);
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
  raf = requestAnimationFrame(() => {
    if (destroyed) return;
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
