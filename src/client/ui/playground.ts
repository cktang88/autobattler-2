// Playground (sandbox): place any of your designs on BOTH halves of the field for free, press Fight, watch, edit,
// run again. No supply, rounds, commander HP or AI: only the per-side army caps the sim needs (MAX_BLOCKS /
// MAX_SIM_UNITS) and the usual placement rules (inside the deploy zone, no overlapping blocks).
// The sim runs directly here (new Battle(...) stepped per frame), drawn with the same BattleView as a match.

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
import { MAX_TICKS, TICK_RATE } from '../../shared/sim/types.ts';
import {
  DEPLOY_D, DEPLOY_W, FIELD_H, MAX_SPACING, blockDims, blockInZone, blockWorldRect, blocksOverlap, hasSpacing, normSpacing,
  placementUnitCenters, type BlockShape,
} from '../../shared/grid.ts';
import { MAX_BLOCKS, MAX_SIM_UNITS } from '../../shared/match.ts';
import { MAX_LEVEL, computeStats, defaultOrders, fmtUnitPrice } from '../../shared/stats.ts';
import type { Design, Placement, Side, UnitStats } from '../../shared/types.ts';
import * as kit from './kit.ts';
import { kiteOptions, miniStats, orderFields, ordersControl, ordersOf, paintPreview, sizeLabel, statCard, type Orders } from './match-ui.ts';
import { spacingControl, worldToLocalRect } from './match.ts';
import { secondaryLeft } from '../render/camera.ts';

type Phase = 'edit' | 'battle' | 'result';
type PlaceSide = 'auto' | 0 | 1;
type Sel = { side: Side; uid: number } | null;

const KEY = 'ab2.playground';
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
        boards[sd] = keep;
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
  let placeSide: PlaceSide = 'auto';
  let newLevel = 1;
  let rotCard = false;
  const cardSpacing = new Map<string, number>();
  const spacingOfCard = (d: Design) => normSpacing(shapeOf(d), cardSpacing.get(d.id) ?? 0);
  let hover: { side: Side; x: number; y: number; shape: BlockShape; spacing: number; rot: boolean; valid: boolean; reason: string | null } | null = null;
  let lastPtr: { px: number; py: number } | null = null;

  // ---------- battle state ----------
  let phase: Phase = 'edit';
  let battle: Battle | null = null;
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
  const fieldwrap = h('div.fieldwrap', null, canvas);
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
  const undoBtn = h('button.small', { title: 'Undo (Backspace / Ctrl+Z)', onclick: () => undo() }, 'Undo');
  const swapBtn = h('button.small', { title: 'Swap the two armies (each keeps its formation, seen from its own side)', onclick: () => swapSides() }, 'Swap sides');
  const clearBlueBtn = h('button.small', { title: 'Remove every Blue block', onclick: () => clearSide(0) }, 'Clear Blue');
  const clearRedBtn = h('button.small', { title: 'Remove every Red block', onclick: () => clearSide(1) }, 'Clear Red');
  const clearAllBtn = h('button.small.danger', { title: 'Remove every block on both sides', onclick: () => clearSide(-1) }, 'Clear all');
  const fightBtn = h('button.big.primary.deploy-btn', { onclick: () => fight() }, 'Fight!');
  const sideEl = h('div.side.pg-side', null,
    h('div.side-top', null, h('div.pg-head', null, h('b', null, 'Playground'), h('span.muted', null, 'Free placement on both sides')), capEl),
    h('div.pg-opts', null, sideSel, levelSel, mapSel),
    cardsEl,
    h('div.side-actions', null,
      h('div.row', null, undoBtn, swapBtn),
      h('div.row', null, clearBlueBtn, clearRedBtn, clearAllBtn),
      fightBtn),
  );

  const hintEl = h('div.hint');
  const miniEl = h('div.mini-wrap.hidden');
  const infoEl = h('div.panel.info.hidden');
  const speedBtns = BATTLE_SPEEDS.map((v) => h('button.small', { title: `${speedLabel(v)} speed`, onclick: () => { speed = v; paused = false; renderSpeed(); } }, speedLabel(v)));
  const pauseBtn = h('button.small.pause-btn', { title: 'Pause / resume (Space or P)', 'aria-label': 'Pause', onclick: () => { paused = !paused; renderSpeed(); } }, '❚❚');
  const skipBtn = h('button.small', { onclick: () => skipBattle() }, 'Skip ▸▸');
  const stopBtn = h('button.small', { title: 'Stop and go back to editing (Esc)', onclick: () => backToEdit() }, 'Edit');
  const speedbar = h('div.speedbar.hidden', null, stopBtn, pauseBtn, ...speedBtns, skipBtn);
  const zoomBar = h('div.zoombtns', null,
    h('button.small', { title: 'Zoom in (+)', 'aria-label': 'Zoom in', onclick: () => view.zoomBy(1.5) }, '+'),
    h('button.small', { title: 'Zoom out (-)', 'aria-label': 'Zoom out', onclick: () => view.zoomBy(1 / 1.5) }, '−'),
    h('button.small', { title: 'Fit whole field and reset the view (F) · right-drag (or Ctrl / Option + drag) turns the view in battle', 'aria-label': 'Fit whole field', onclick: () => view.fit() }, '⤢'),
  );
  const overlayEl = h('div');
  fieldwrap.append(hintEl, miniEl, infoEl, speedbar, zoomBar, overlayEl);

  const el = h('div.screen.match.playground', null, topbar, h('div.mbody', null, fieldwrap, sideEl));
  // mouse-clicked buttons must not keep focus (Space would re-press them instead of fighting / pausing)
  el.addEventListener('mousedown', (e) => {
    const b = (e.target as HTMLElement | null)?.closest('button');
    if (!b || b.getAttribute('role') === 'combobox') return;
    e.preventDefault();
  });

  // ---------- cards ----------
  const cardEls: HTMLButtonElement[] = designs.map((d, i) => {
    const st = statsOf(d)!;
    return h('button.card', { onclick: () => selectCard(i), title: `${d.name} · ${sizeLabel(st.size)}${st.flying ? ' · Air' : ''}` },
      h('canvas'),
      h('span.key', null, i < 9 ? String(i + 1) : ''),
      h('span.count'),
      st.squad > 1 ? h('span.card-squad', { title: `One block is a squad of ${st.squad} units` }, `×${st.squad}`) : null,
      h('div.name', null, d.name),
      h('div.meta', null,
        h('span.cost', { title: st.squad > 1 ? `Match price: ${st.squad} units (≈${fmtUnitPrice(st.unitCost)} each). Free here.` : 'Match price (free here)' }, String(st.cost)),
        h('span', null, `${sizeLabel(st.size)}${st.flying ? ' · Air' : ''}`)),
    );
  });
  cardsEl.replaceChildren(...cardEls);
  if (!designs.length) cardsEl.append(h('p.muted', { style: { gridColumn: '1 / -1' } }, 'No valid designs. Build some in the Garage first.'));
  const paintCards = () => requestAnimationFrame(() => cardEls.forEach((b, i) => paintPreview(b.querySelector('canvas')!, designs[i], 0)));

  function selectCard(i: number) {
    if (phase !== 'edit' || !designs[i]) return;
    selCard = selCard === i ? -1 : i;
    sel = null;
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
    cardEls.forEach((b, i) => {
      const d = designs[i];
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
    if (phase === 'edit') {
      const d = designs[selCard];
      if (d) t = hover && !hover.valid && hover.reason ? hover.reason
        : `Place ${d.name} on ${placeSide === 'auto' ? 'either side' : SIDE_NAME[placeSide]}${hasSpacing(shapeOf(d)) ? ' · [ ] spacing · R rotate' : ''} · Esc to cancel`;
      else if (sel) t = 'Drag a block to move it · Del removes it · Esc to deselect';
      else t = boards[0].length || boards[1].length ? 'Pick a card to place more · click a block to edit it · drag to move' : 'Pick a card, then click either half of the field';
    } else if (phase === 'battle') t = paused ? 'Paused' : '';
    hintEl.textContent = t;
    hintEl.classList.toggle('hidden', !t);
    const cd = phase === 'edit' && !sel ? designs[selCard] : undefined;
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
    renderHint();
  }

  // ---------- selected block panel ----------
  function setOrders(s: NonNullable<Sel>, patch: Partial<Orders>) {
    const i = boards[s.side].findIndex((p) => p.uid === s.uid);
    if (i < 0) return;
    const p = boards[s.side][i];
    const defs = defsOf(p.designId);
    const next: Orders = { ...ordersOf(p, defs), ...patch };
    const { target: _t, hold: _h, kite: _k, kiteMount: _km, focus: _f, stance: _s, delay: _d, retreat: _r, escort: _e, ...rest } = p;
    snap();
    boards[s.side][i] = { ...rest, ...orderFields({ ...next, hold: next.hold && hasSpacing(shapeOf(byId.get(p.designId))) }, defs) };
    sfx('click');
    changed();
  }
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
  function removeBlock(s: NonNullable<Sel>) {
    if (!find(s)) return;
    snap();
    boards[s.side] = boards[s.side].filter((p) => p.uid !== s.uid);
    if (sel && sel.side === s.side && sel.uid === s.uid) sel = null;
    sfx('click');
    changed();
  }
  function renderInfo() {
    const s = phase === 'edit' ? sel : null;
    const p = s && find(s);
    const d = p && byId.get(p.designId);
    const st = d && statsOf(d);
    if (!s || !p || !d || !st) { infoEl.classList.add('hidden'); infoEl.replaceChildren(); return; }
    const prev = h('canvas');
    const squad = st.squad > 1;
    const defs = defsOf(p.designId);
    infoEl.replaceChildren(
      h('button.icon.small.ghost.close', { onclick: () => { sel = null; renderAll(); } }, '✕'),
      h('div.head', null, prev, h('div', null,
        h('h3', { class: s.side === 0 ? 'friendly' : 'enemy' }, d.name),
        h('div.sc-sub', null, `${SIDE_NAME[s.side]} side`))),
      h('div.info-spacing', null, h('div.sp-head', null, h('span', null, 'Level')), kit.segmented<number>({
        value: p.level, label: 'Block level', className: 'full',
        options: Array.from({ length: MAX_LEVEL }, (_, i) => ({ value: i + 1, label: '★'.repeat(i + 1) })),
        onChange: (v) => editBlock(s, (q) => ({ ...q, level: v })),
      })),
      statCard({ design: d, st, level: p.level, spacing: normSpacing(st, p.spacing), rot: !!p.rot }),
      h('div.info-spacing', null, ordersControl(ordersOf(p, defs), squad, (patch) => setOrders(s, patch), { kiteOptions: kiteOptions(d), defaults: defs })),
      squad ? h('div.info-spacing', null, spacingControl(normSpacing(st, p.spacing), (v) => setSpacing(s, v), shapeOf(d), !!p.rot)) : '',
      h('div.actions', null,
        squad ? h('button.small', { title: 'Turn the formation 90° (R)', onclick: () => rotateSel(s) }, '⟳ Rotate') : null,
        h('button.small.danger', { title: 'Remove this block (Del)', onclick: () => removeBlock(s) }, 'Remove')),
    );
    infoEl.classList.remove('hidden');
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
        h('button', { title: 'Back to placing units (Esc)', onclick: () => backToEdit() }, 'Edit layout'),
        h('button', { title: 'Watch the exact same battle again', onclick: () => fight(seed) }, 'Replay'),
        again),
    ));
  }

  function renderAll() {
    renderTop();
    renderCaps();
    renderOpts();
    renderCards();
    renderInfo();
    renderSpeed();
    renderOverlay();
  }

  // ---------- edit actions ----------
  function undo() {
    if (phase !== 'edit') return;
    const s = undoStack.pop();
    if (!s) return;
    boards = JSON.parse(s);
    if (sel && !find(sel)) sel = null;
    sfx('click');
    changed();
  }
  function clearSide(sd: Side | -1) {
    if (phase !== 'edit') return;
    snap();
    if (sd !== 1) boards[0] = [];
    if (sd !== 0) boards[1] = [];
    sel = null;
    sfx('click');
    changed();
  }
  function swapSides() {
    if (phase !== 'edit') return;
    snap();
    boards = [boards[1], boards[0]];
    if (sel) sel = { side: (1 - sel.side) as Side, uid: sel.uid };
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
    const reason = problem(sd, candidate(d, sd, x, y, spacing, rot));
    return { side: sd, x, y, shape, spacing, rot, valid: !reason, reason };
  }
  const candidate = (d: Design, _sd: Side, x: number, y: number, spacing: number, rot: boolean): Placement => ({
    uid: nextUid, designId: d.id, x, y, level: newLevel, round: 1,
    ...(hasSpacing(shapeOf(d)) ? { spacing } : {}), ...(rot ? { rot: true } : {}), ...newOrders(d),
  });

  function placeAt(px: number, py: number) {
    hover = computeHover(px, py);
    const d = designs[selCard];
    if (!hover || !d) return;
    if (!hover.valid) { sfx('invalid'); if (hover.reason) app.toast(hover.reason, 'error'); return; }
    snap();
    boards[hover.side].push(candidate(d, hover.side, hover.x, hover.y, hover.spacing, hover.rot));
    nextUid++;
    sfx('place');
    save();
    hover = computeHover(px, py);
    renderAll();
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
    return at(py) ?? (view.tilted ? at(py + 0.28 * view.cam.k) : null);
  }

  let downAt: { x: number; y: number } | null = null;
  let moveDrag: { s: NonNullable<Sel>; offX: number; offY: number; ox: number; oy: number; started: boolean; reason: string | null; before: string } | null = null;

  canvas.addEventListener('pointerdown', (e) => {
    downAt = { x: e.clientX, y: e.clientY };
    moveDrag = null;
    if (phase === 'edit' && selCard < 0 && e.button === 0 && !secondaryLeft(e)) {
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
    try { canvas.setPointerCapture(e.pointerId); } catch { /* */ }
    if (phase === 'edit' && selCard >= 0) { const { px, py } = local(e); hover = computeHover(px, py); renderHint(); }
  });
  canvas.addEventListener('pointermove', (e) => {
    const lp = local(e);
    lastPtr = { px: lp.px, py: lp.py };
    if (moveDrag && downAt) {
      if (!moveDrag.started && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) { moveDrag.started = true; canvas.style.cursor = 'grabbing'; }
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
    if (phase !== 'edit' || selCard < 0) return;
    if (e.pointerType === 'touch' && !downAt) return;
    const prev = hover;
    hover = computeHover(lp.px, lp.py);
    if (prev?.x !== hover?.x || prev?.y !== hover?.y || prev?.valid !== hover?.valid || prev?.side !== hover?.side) renderHint();
  });
  canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { hover = null; lastPtr = null; renderHint(); } });
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
      save();
    }
    renderAll();
    return true;
  }
  canvas.addEventListener('pointercancel', () => { downAt = null; hover = null; endMove(false); });
  canvas.addEventListener('pointerup', (e) => {
    const start = downAt;
    downAt = null;
    if (endMove(true)) return;
    if (!start || e.button > 0 || secondaryLeft(e) || view.wasDrag) return;
    if (phase !== 'edit') return;
    const { px, py, rawY } = local(e);
    if (selCard >= 0) { placeAt(px, py); if (e.pointerType === 'touch') { hover = null; renderHint(); } return; }
    sel = blockAt(px, rawY);
    if (sel) sfx('click');
    renderAll();
  });
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (selCard >= 0) { selCard = -1; hover = null; renderAll(); }
  });

  // ---------- keyboard ----------
  function stepSpacing(dir: number): boolean {
    const d = designs[selCard];
    if (d && hasSpacing(shapeOf(d))) {
      cardSpacing.set(d.id, Math.max(0, Math.min(MAX_SPACING, spacingOfCard(d) + dir)));
      if (lastPtr) hover = computeHover(lastPtr.px, lastPtr.py);
      sfx('click'); renderAll(); return true;
    }
    const p = sel && find(sel);
    if (sel && p && hasSpacing(shapeOf(byId.get(p.designId)))) { setSpacing(sel, normSpacing(shapeOf(byId.get(p.designId)), p.spacing) + dir); return true; }
    return false;
  }
  const onKey = (e: KeyboardEvent) => {
    if (document.querySelector('.modal-back') || document.querySelector('.k-pop')) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.getAttribute('role') === 'combobox')) return;
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    if (phase === 'edit' && plain && e.key >= '1' && e.key <= '9') { selectCard(Number(e.key) - 1); e.preventDefault(); }
    else if (phase === 'edit' && plain && e.key.toLowerCase() === 'r') {
      const d = designs[selCard];
      if (d) { if (hasSpacing(shapeOf(d))) { rotCard = !rotCard; if (lastPtr) hover = computeHover(lastPtr.px, lastPtr.py); sfx('click'); renderAll(); } }
      else if (sel) { const p = find(sel); if (p && hasSpacing(shapeOf(byId.get(p.designId)))) rotateSel(sel); }
      e.preventDefault();
    } else if (phase === 'edit' && plain && e.key.toLowerCase() === 't') {
      placeSide = placeSide === 'auto' ? 0 : placeSide === 0 ? 1 : 'auto';
      if (lastPtr) hover = computeHover(lastPtr.px, lastPtr.py);
      sfx('click'); renderAll(); e.preventDefault();
    } else if (phase === 'edit' && plain && (e.key === '[' || e.key === ']')) { if (stepSpacing(e.key === ']' ? 1 : -1)) e.preventDefault(); }
    else if (phase === 'edit' && (e.key === 'Delete' || (e.key === 'Backspace' && sel))) { if (sel) { removeBlock(sel); e.preventDefault(); } }
    else if (phase === 'edit' && (e.key === 'Backspace' || (e.key === 'z' && (e.ctrlKey || e.metaKey)))) { undo(); e.preventDefault(); }
    else if (plain && e.key.toLowerCase() === 'p' && phase === 'battle') { paused = !paused; renderSpeed(); e.preventDefault(); }
    // (F / Home = fit is the camera's own key: CameraControls handles it, so it isn't fitted twice here)
    else if (e.key === 'Escape') {
      if (phase !== 'edit') backToEdit();
      else if (selCard >= 0) { selCard = -1; hover = null; renderAll(); }
      else { sel = null; renderAll(); }
    } else if (e.key === ' ' || e.key === 'Enter') {
      if (t && t.tagName === 'BUTTON') return;
      e.preventDefault();
      if (phase === 'edit') fight();
      else if (phase === 'battle') { if (e.key === ' ') { paused = !paused; renderSpeed(); } else skipBattle(); }
      else fight();
    }
  };
  document.addEventListener('keydown', onKey);

  // ---------- battle ----------
  function fight(withSeed?: number) {
    if (phase === 'battle') return;
    if (!boards[0].length || !boards[1].length) { sfx('invalid'); app.toast('Place at least one block on each side', 'error'); return; }
    seed = withSeed ?? randomSeed();
    try {
      battle = new Battle({ seed, sides: [{ designs, units: structuredClone(boards[0]) }, { designs, units: structuredClone(boards[1]) }] });
    } catch (e) {
      console.error('playground battle', e);
      app.toast('The battle could not start: ' + (e as Error).message, 'error');
      battle = null;
      return;
    }
    acc = 0; endTimer = 0; paused = false;
    selCard = -1; sel = null; hover = null;
    phase = 'battle';
    sfx('ready');
    playMusic('battle');
    try { view.fit(); } catch { /* */ }
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
  }
  function backToEdit() {
    if (phase === 'edit') return;
    phase = 'edit';
    battle = null;
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
        const selected = !!sel && sel.side === sd && sel.uid === p.uid;
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
    const p = sel && find(sel);
    if (!sel || !p) return null;
    const r = blockWorldRect(sel.side, p, shapeOf(byId.get(p.designId)));
    return { col: r.col, row: r.row, size: Math.max(r.w, r.h), w: r.w, h: r.h, valid: !moveDrag?.reason };
  }

  let raf = 0;
  let last = performance.now();
  let drawErr = false;
  let topT = 0;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    view.controls.doubleClickZoom = phase !== 'edit' || (selCard < 0 && !sel);
    view.controls.rotate = !!view.canRotate && phase !== 'edit'; // right-drag turns the 3D view while watching
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
        view.drawBattle(battle, dt);
      } else {
        view.drawBoard(boardUnits(), { showZone: true, hover: outline() }, now / 1000);
      }
      minimap.update(miniDots());
    } catch (e) {
      if (!drawErr) { drawErr = true; console.error('playground draw', e); }
    }
  };

  const ro = new ResizeObserver(() => { try { view.resize(); } catch { /* */ } });
  ro.observe(fieldwrap);
  let gone = false;

  playMusic('deploy');
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
      document.removeEventListener('keydown', onKey);
      try { view.destroy(); } catch { /* */ }
      minimap.destroy();
    },
  };
}
