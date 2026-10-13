// Main gameplay screen: deploy phase (shop + placement on the field), waiting (pvp), battle replay,
// round result, game over. Works with any MatchDriver (LocalDriver for AI, NetDriver for PvP).

import { h, type App, type Route, type Screen } from '../app.ts';
import { playMusic, sfx } from '../audio.ts';
import { activeDeck } from '../collection.ts';
import type { MatchDriver } from '../driver.ts';
import { LocalDriver, lastWatched, setLastWatched } from '../localdriver.ts';
import { drawPartIcon, FieldView, type PartKind, type BoardOverlay, type BoardUnit } from '../render/field.ts';
import { loadSettings } from '../storage.ts';
import { Battle } from '../../shared/sim/battle.ts';
import { MAX_TICKS, TICK_RATE, type BattleEvent } from '../../shared/sim/types.ts';
import { DEPLOY_D, DEPLOY_W, FIELD_W, MAX_SPACING, blockCells, blockInZone, fmtMeters, fmtSpeed, hasSpacing, localToWorldCell, normSpacing, placementUnitCenters } from '../../shared/grid.ts';
import { battleInputFor, START_HP, upgradeCost, validateDeploy } from '../../shared/match.ts';
import { CHASSIS_BY_ID, MOBILITY_BY_ID, MODULE_BY_ID } from '../../shared/parts.ts';
import { MAX_LEVEL, computeStats, firingStyle, levelMult, weaponDps } from '../../shared/stats.ts';
import type { DeployAction, Design, MatchState, Placement, RoundRecord, Side, Size, UnitStats } from '../../shared/types.ts';
import { confirmModal, paintPreview, sizeLabel } from './match-ui.ts';
import { playerName } from './vsai.ts';

type Phase = 'deploy' | 'waiting' | 'battle' | 'result' | 'over';

/** Inverse of localToWorldCell: top-left world cell -> local deploy-grid coords for `side`. */
export function worldToLocalCell(side: Side, col: number, row: number, size: number): { x: number; y: number } {
  if (side === 0) return { x: col, y: row - (localToWorldCell(0, 0, 0, size as Size).row) };
  return { x: FIELD_W - col - size, y: DEPLOY_D - row - size };
}

/** last spacing chosen per design id (kept across matches) */
const lastSpacing = new Map<string, number>();

/** Tiny diagram of a 4-unit squad at the given spacing, plus the footprint in metres. */
function spacingDiagram(spacing: number): SVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const cells = 2 + spacing, px = 8;
  const svg = document.createElementNS(NS, 'svg');
  const W = cells * px;
  svg.setAttribute('viewBox', `0 0 ${W} ${W}`);
  svg.setAttribute('width', '34');
  svg.setAttribute('height', '34');
  svg.setAttribute('class', 'sp-diagram');
  svg.setAttribute('aria-hidden', 'true');
  const r = document.createElementNS(NS, 'rect');
  r.setAttribute('x', '0.5'); r.setAttribute('y', '0.5'); r.setAttribute('width', String(W - 1)); r.setAttribute('height', String(W - 1));
  r.setAttribute('class', 'fp');
  svg.append(r);
  const far = 1.5 + spacing;
  for (const [cx, cy] of [[0.5, 0.5], [far, 0.5], [0.5, far], [far, far]]) {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', String(cx * px)); c.setAttribute('cy', String(cy * px)); c.setAttribute('r', '2.2');
    svg.append(c);
  }
  return svg;
}

/** Segmented spacing control: "Spacing 0 1 2 3 4" + live diagram + footprint size. */
function spacingControl(value: number, onPick: ((v: number) => void) | null): HTMLElement {
  const segs = Array.from({ length: MAX_SPACING + 1 }, (_, v) => h('button.seg', {
    type: 'button',
    class: v === value ? 'on' : null,
    disabled: !onPick,
    'aria-pressed': String(v === value),
    title: `${v} empty ${v === 1 ? 'cell' : 'cells'} between units`,
    onclick: () => onPick?.(v),
  }, String(v)));
  const fp = fmtMeters(blockCells(1, value));
  return h('div.spacing', null,
    h('div.sp-head', null, h('span', null, 'Spacing'), h('span.muted', null, ...(onPick ? [h('kbd', null, '['), ' ', h('kbd', null, ']')] : ['locked']))),
    h('div.sp-row', null, spacingDiagram(value), h('div.sp-segs', { role: 'group', 'aria-label': 'Squad spacing' }, ...segs)),
    h('div.sp-foot', null, `Footprint ${fp} × ${fp}`),
  );
}

type Op = { kind: 'place' | 'upgrade'; uid: number };
type Sel = { side: Side; uid: number; pending: boolean } | null;
type FieldWithEvents = FieldView & { pushEvents?: (events: BattleEvent[]) => void };

function loadoutIcon(kind: PartKind, id: string, px: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.className = 'lo-icon';
  c.style.width = c.style.height = `${px}px`;
  c.setAttribute('aria-hidden', 'true');
  requestAnimationFrame(() => { try { drawPartIcon(c, kind, id, { backdrop: true }); } catch { /* icon unavailable */ } });
  return c;
}
const shorten = (t: string, n = 44) => { const f = t.split(/(?<=[.;])\s/)[0] ?? t; return f.length > n ? `${f.slice(0, n - 1).trimEnd()}…` : f; };
const num1 = (n: number) => String(Math.round(n * 10) / 10);

const stars = (lv: number) => '★'.repeat(lv) + '☆'.repeat(Math.max(0, MAX_LEVEL - lv));

export function matchScreen(app: App, route: Extract<Route, { name: 'match' }>): Screen {
  const driver: MatchDriver = route.driver;
  const side = driver.side;
  const opp = (1 - side) as Side;
  let m: MatchState = driver.state();
  const settings = loadSettings();
  let speed = [1, 2, 4].includes(settings.battleSpeed) ? settings.battleSpeed : 1;

  // ---------- design lookup ----------
  const statCache = new Map<Design, UnitStats | null>();
  const statsOf = (d: Design): UnitStats | null => {
    if (!statCache.has(d)) { try { statCache.set(d, computeStats(d)); } catch { statCache.set(d, null); } }
    return statCache.get(d)!;
  };
  const designOf = (s: Side, id: string): Design | undefined => m.players[s].deck.find((d) => d.id === id);
  const sizeOf = (d: Design | undefined): Size => (d ? statsOf(d)?.size ?? 1 : 1);
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
  let hover: { x: number; y: number; size: Size; spacing: number; cells: number; valid: boolean; reason: string | null } | null = null;
  let hoverUnit: Sel = null; // block under the mouse (nothing selected in the shop)
  let lastPtr: { px: number; py: number } | null = null;
  let submitting = false;

  // ---------- battle state ----------
  let phase: Phase = 'deploy';
  let battle: Battle | null = null;
  let replay: RoundRecord | null = null;
  let acc = 0;
  let endTimer = 0;
  let destroyed = false;

  const me = () => m.players[side];
  const foe = () => m.players[opp];
  const deck = () => me().deck;
  const action = (): DeployAction => ({ round: m.round, place: place.map((p) => ({ ...p })), upgrade: [...upgrades] });
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
    nextUid = me().nextUid;
    selCard = -1;
    sel = null;
    hover = null;
  }

  // ---------- DOM ----------
  const canvas = h('canvas');
  const fieldwrap = h('div.fieldwrap', null, canvas);
  const view: FieldWithEvents = new FieldView(canvas, side);

  const roundEl = h('div.round');
  const hpMe = h('div.hp.me');
  const hpFoe = h('div.hp.foe');
  const leaveBtn = h('button.icon.small', { title: 'Leave match', onclick: () => leave() }, '‹', h('span.hide-sm', null, 'Leave'));
  const topbar = h('div.mbar', null, leaveBtn, hpMe, roundEl, hpFoe);

  const supplyVal = h('div.val');
  const supplyLbl = h('div.lbl', null, 'Supply', h('br'), 'remaining');
  const cardsEl = h('div.cards');
  const undoBtn = h('button.small', { onclick: () => undo(), title: 'Undo (Backspace)' }, 'Undo');
  const clearBtn = h('button.small', { onclick: () => clearAll(), title: 'Clear all pending' }, 'Clear');
  const deployBtn = h('button.big.primary.deploy-btn', { onclick: () => submit() }, 'Deploy & Fight');
  const shopSpacingEl = h('div.shop-spacing.hidden');
  const sideEl = h('div.side', null,
    h('div.side-top', null, h('div.supply', null, supplyVal, supplyLbl, h('div.spacer'), h('span.kbd-hint.muted', { style: { fontSize: '0.75rem' } }, h('kbd', null, '1-9'), ' select'))),
    cardsEl,
    shopSpacingEl,
    h('div.side-actions', null, h('div.row', null, undoBtn, clearBtn), deployBtn),
  );

  const hintEl = h('div.hint');
  const infoEl = h('div.panel.info.hidden');
  const speedBtns = [1, 2, 4].map((v) => h('button.small', { onclick: () => { speed = v; renderSpeed(); } }, `${v}×`));
  const skipBtn = h('button.small', { onclick: () => skipBattle() }, 'Skip ▸▸');
  const speedbar = h('div.speedbar.hidden', null, ...speedBtns, skipBtn);
  const overlayEl = h('div');
  const zoomBar = h('div.zoombtns', null,
    h('button.small', { title: 'Zoom in (+)', 'aria-label': 'Zoom in', onclick: () => view.zoomBy(1.5) }, '+'),
    h('button.small', { title: 'Zoom out (-)', 'aria-label': 'Zoom out', onclick: () => view.zoomBy(1 / 1.5) }, '−'),
    h('button.small', { title: 'Fit whole field (F)', 'aria-label': 'Fit whole field', onclick: () => view.fit() }, '⤢'),
  );
  fieldwrap.append(hintEl, infoEl, speedbar, zoomBar, overlayEl);

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
    cardsEl.replaceChildren(...cardEls);
    paintCards();
  }
  let tipEl: HTMLElement | null = null;
  function hideTip() { tipEl?.remove(); tipEl = null; }
  function showTip(b: HTMLElement, d: Design) {
    hideTip();
    const mods = d.mounts.map((id) => (id ? MODULE_BY_ID.get(id) : undefined)).filter((x): x is NonNullable<typeof x> => !!x);
    if (!mods.length) return;
    const tip = h('div.deck-tip', { role: 'tooltip' }, ...mods.map((md) => {
      const c = loadoutIcon('module', md.id, 28);
      c.title = md.name;
      return c;
    }));
    el.append(tip);
    tipEl = tip;
    const r = b.getBoundingClientRect(), er = el.getBoundingClientRect();
    const w = tip.offsetWidth, ht = tip.offsetHeight;
    const left = Math.max(4, Math.min(er.width - w - 4, r.left - er.left + r.width / 2 - w / 2));
    let top = r.top - er.top - ht - 6;
    if (top < 4) top = r.bottom - er.top + 6;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }
  function attachDeckTip(b: HTMLElement, d: Design) {
    let timer = 0;
    b.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') showTip(b, d); });
    b.addEventListener('pointerleave', () => { clearTimeout(timer); hideTip(); });
    b.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      clearTimeout(timer);
      timer = window.setTimeout(() => { showTip(b, d); b.dataset.lp = '1'; }, 450);
    });
    const cancel = () => { clearTimeout(timer); if (tipEl) setTimeout(hideTip, 1200); };
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
    cardEls.forEach((b, i) => {
      const d = deck()[i];
      const cost = costOf(d);
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
    roundEl.replaceChildren(document.createTextNode(`Round ${shownRound}`), h('small', null, tag));
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
    supplyVal.textContent = String(rem);
    supplyVal.classList.toggle('low', rem < 0);
    const deploying = phase === 'deploy';
    undoBtn.disabled = !deploying || ops.length === 0;
    clearBtn.disabled = !deploying || ops.length === 0;
    deployBtn.disabled = !deploying || submitting;
    deployBtn.textContent = submitting ? 'Deploying…' : 'Deploy & Fight';
    renderCards();
    renderShopSpacing();
  }

  function renderShopSpacing() {
    const d = phase === 'deploy' ? deck()[selCard] : undefined;
    if (!d || !hasSpacing(sizeOf(d))) { shopSpacingEl.classList.add('hidden'); shopSpacingEl.replaceChildren(); return; }
    shopSpacingEl.classList.remove('hidden');
    shopSpacingEl.replaceChildren(spacingControl(spacingOfCard(d), (v) => setCardSpacing(v)));
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
    const cells = blockCells(size, sp);
    const next: Placement = { ...p, spacing: sp, x: Math.max(0, Math.min(DEPLOY_W - cells, p.x)), y: Math.max(0, Math.min(DEPLOY_D - cells, p.y)) };
    const cand = action();
    cand.place[i] = next;
    const err = check(cand);
    if (err) { sfx('invalid'); app.toast(err, 'error'); renderAll(); return; }
    place[i] = next;
    lastSpacing.set(p.designId, sp);
    sfx('click');
    renderAll();
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
    if (phase === 'deploy') {
      const d = deck()[selCard];
      if (d) t = hover && !hover.valid && hover.reason ? hover.reason : `Place ${d.name}${squadOf(d) > 1 ? ' squad' : ''} in your zone${hasSpacing(sizeOf(d)) ? ' · [ ] spacing' : ''} · Esc to cancel`;
      else t = place.length ? 'Tap a new block to adjust or remove it · tap your units to upgrade' : 'Pick a unit card, then tap your zone to deploy';
    } else if (phase === 'battle') t = 'Battle in progress';
    hintEl.textContent = t;
    hintEl.classList.toggle('hidden', !t);
  }

  function renderSpeed() {
    speedBtns.forEach((b, i) => b.classList.toggle('active', [1, 2, 4][i] === speed));
    speedbar.classList.toggle('hidden', phase !== 'battle');
  }

  // ---------- info panel ----------
  function renderInfo() {
    if (!sel || (phase !== 'deploy' && phase !== 'waiting')) { infoEl.classList.add('hidden'); return; }
    const s = sel;
    const p = s.pending ? place.find((x) => x.uid === s.uid) : m.players[s.side].board.find((x) => x.uid === s.uid);
    const d = p && designOf(s.side, p.designId);
    const st = d && statsOf(d);
    if (!p || !d || !st) { sel = null; infoEl.classList.add('hidden'); return; }
    const mine = s.side === side;
    const ups = mine && !s.pending ? pendingUps(p.uid) : 0;
    const lv = p.level + ups;
    const mult = levelMult(lv);
    const squad = st.squad ?? 1;
    const sp = normSpacing(st.size, p.spacing);
    const prev = h('canvas');
    const stat = (label: string, v: string, up = false) => h('div', null, h('span', null, label), h('b', { class: up ? 'up' : null }, v));
    const parts = [CHASSIS_BY_ID.get(d.chassis)?.name, MOBILITY_BY_ID.get(d.mobility)?.name, ...d.mounts.filter(Boolean).map((id) => MODULE_BY_ID.get(id!)?.name)].filter(Boolean).join(' · ');
    const actions: HTMLElement[] = [];
    const loRow = (kind: PartKind, id: string, label: string, name: string, stat: string) =>
      h('li', null, loadoutIcon(kind, id, 32), h('div.lo-txt', null, h('div.lo-name', null, h('span.lo-kind', null, label), name), h('div.lo-stat', null, stat)));
    const loadout: HTMLElement[] = [];
    const ch = CHASSIS_BY_ID.get(d.chassis), mo = MOBILITY_BY_ID.get(d.mobility);
    if (ch) loadout.push(loRow('chassis', ch.id, 'Chassis', ch.name, `${ch.hp} HP · armor ${ch.armor}`));
    if (mo) loadout.push(loRow('mobility', mo.id, 'Mobility', mo.name, `${mo.kind} · speed ${fmtSpeed(mo.speed)}`));
    for (const id of d.mounts) {
      const md = id ? MODULE_BY_ID.get(id) : undefined;
      if (!md) continue;
      const stat = md.kind === 'weapon'
        ? `${num1(weaponDps(md))} dps · range ${fmtMeters(md.range ?? 0)} · ${firingStyle(md)}`
        : shorten(md.desc);
      loadout.push(loRow('module', md.id, md.kind === 'weapon' ? 'Weapon' : md.kind === 'armor' ? 'Armor' : 'Utility', md.name, stat));
    }
    if (mine && phase === 'deploy') {
      if (s.pending) {
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
        h('div.stars', null, stars(lv), ups ? h('span.good', { style: { fontSize: '0.8rem', marginLeft: '6px' } }, `+${ups} pending`) : null),
        squad > 1 ? h('div.squad-tag', null, `Squad ×${squad}`, h('span', null, ` · block ${st.cost}`)) : null,
        h('div.muted', { style: { fontSize: '0.8rem' } }, `${mine ? (s.pending ? 'New this round' : `Deployed round ${p.round}`) : 'Enemy unit'} · ${sizeLabel(st.size)}${st.flying ? ' · Air' : st.isStatic ? ' · Static' : ''}`),
      )),
      h('div.stats', null,
        stat(squad > 1 ? 'HP / unit' : 'HP', String(Math.round(st.hp * mult)), ups > 0),
        stat(squad > 1 ? 'DPS / unit' : 'DPS', String(Math.round(st.dps * mult)), ups > 0),
        squad > 1 ? stat('HP / block', String(Math.round(st.hp * mult * squad)), ups > 0) : null,
        squad > 1 ? stat('DPS / block', String(Math.round(st.dps * mult * squad)), ups > 0) : null,
        stat('Armor', String(st.armor)),
        stat('Range', st.range ? fmtMeters(st.range) : '—'),
        stat('Speed', st.isStatic ? '—' : fmtSpeed(st.speed)),
        stat(squad > 1 ? 'Block cost' : 'Cost', String(st.cost)),
        squad > 1 ? stat('Unit value', String(st.unitCost)) : null,
        st.shield ? stat('Shield', String(st.shield)) : null,
        st.heal ? stat('Repair', `${st.heal}/s`) : null,
      ),
      squad > 1 ? h('div.info-spacing', null, spacingControl(sp, mine && phase === 'deploy' && s.pending ? (v) => setPendingSpacing(p.uid, v) : null)) : '',
      h('div.parts', null, parts),
      loadout.length ? h('div.loadout', null, h('div.lo-title', null, 'Loadout'), h('ul', null, ...loadout)) : '',
      actions.length ? h('div.actions', null, ...actions) : '',
    );
    infoEl.classList.remove('hidden');
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
          h('span', null, 'Damage dealt'), h('b.good', null, String(r.damage[opp])),
          h('span', null, 'Damage taken'), h('b.bad', null, String(r.damage[side])),
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
          h('span', null, 'Damage dealt'), h('b.good', null, String(dealt)),
          h('span', null, 'Damage taken'), h('b.bad', null, String(taken)),
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
  function computeHover(px: number, py: number): typeof hover {
    const d = deck()[selCard];
    if (!d) return null;
    const size = sizeOf(d);
    const spacing = spacingOfCard(d);
    const cells = blockCells(size, spacing);
    let w: { x: number; y: number };
    try { w = view.screenToWorld(px, py); } catch { return null; }
    const col = Math.round(w.x - cells / 2), row = Math.round(w.y - cells / 2);
    let { x, y } = worldToLocalCell(side, col, row, cells);
    if (y > DEPLOY_D + 2 || y < -cells - 1 || x < -cells - 1 || x > DEPLOY_W + 1) return null; // far outside our zone
    x = Math.max(0, Math.min(DEPLOY_W - cells, x));
    y = Math.max(0, Math.min(DEPLOY_D - cells, y));
    let reason: string | null = null;
    if (!blockInZone(x, y, size, spacing)) reason = 'Outside your deploy zone';
    else if (costOf(d) > remaining()) reason = 'Not enough supply';
    else {
      const cand = action();
      cand.place.push({ uid: nextUid, designId: d.id, x, y, level: 1, round: m.round, ...(hasSpacing(size) ? { spacing } : {}) });
      reason = check(cand);
    }
    return { x, y, size, spacing, cells, valid: !reason, reason };
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
    place.push({ uid, designId: d.id, x: hover.x, y: hover.y, level: 1, round: m.round, ...(hasSpacing(hover.size) ? { spacing: hover.spacing } : {}) });
    ops.push({ kind: 'place', uid });
    sfx('place');
    if (costOf(d) > remaining()) { selCard = -1; hover = null; }
    else hover = computeHover(px, py);
    renderAll();
  }

  function removePending(uid: number) {
    place = place.filter((p) => p.uid !== uid);
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
    if (o.kind === 'place') { place = place.filter((p) => p.uid !== o.uid); if (sel?.pending && sel.uid === o.uid) sel = null; }
    else { const i = upgrades.lastIndexOf(o.uid); if (i >= 0) upgrades.splice(i, 1); }
    sfx('click');
    renderAll();
  }

  function clearAll() {
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
    let w: { x: number; y: number };
    try { w = view.screenToWorld(px, py); } catch { return null; }
    // anywhere inside the block's footprint (including the gaps between squad units) selects the block
    const hit = (s: Side, p: Placement) => {
      const cells = blockCells(sizeOf(designOf(s, p.designId)), p.spacing);
      const wc = localToWorldCell(s, p.x, p.y, cells);
      return w.x >= wc.col && w.x <= wc.col + cells && w.y >= wc.row && w.y <= wc.row + cells;
    };
    if (phase === 'deploy') for (const p of place) if (hit(side, p)) return { side, uid: p.uid, pending: true };
    for (const p of me().board) if (hit(side, p)) return { side, uid: p.uid, pending: false };
    for (const p of foe().board) if (hit(opp, p)) return { side: opp, uid: p.uid, pending: false };
    return null;
  }

  let downAt: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    downAt = { x: e.clientX, y: e.clientY };
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
    if ((phase === 'deploy' || phase === 'waiting') && (selCard < 0 || phase !== 'deploy') && e.pointerType === 'mouse') {
      const hu = unitAt(lp.px, lp.rawY);
      hoverUnit = hu && !(sel && hu.side === sel.side && hu.uid === sel.uid && hu.pending === sel.pending) ? hu : null;
    } else hoverUnit = null;
    if (phase !== 'deploy' || selCard < 0) return;
    if (e.pointerType === 'touch' && !downAt) return;
    const { px, py } = local(e);
    const prev = hover;
    hover = computeHover(px, py);
    if (prev?.x !== hover?.x || prev?.y !== hover?.y || prev?.valid !== hover?.valid) renderHint();
  });
  canvas.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') { hover = null; hoverUnit = null; lastPtr = null; renderHint(); }
  });
  canvas.addEventListener('pointercancel', () => { downAt = null; hover = null; });
  canvas.addEventListener('pointerup', (e) => {
    const start = downAt;
    downAt = null;
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
    if (e.key >= '1' && e.key <= '9' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      selectCard(Number(e.key) - 1);
      e.preventDefault();
    } else if ((e.key === '[' || e.key === ']') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (stepSpacing(e.key === ']' ? 1 : -1)) e.preventDefault();
    } else if (e.key === 'Escape') {
      if (selCard >= 0) { selCard = -1; hover = null; }
      else sel = null;
      renderAll();
    } else if (e.key === ' ' || e.key === 'Enter') {
      if (t && t.tagName === 'BUTTON' && e.key === 'Enter') return; // let the focused button handle it
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
    if (p === 'deploy' && prev !== 'deploy') { playMusic('deploy'); try { view.frameDeploy(); } catch { /* */ } }
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
    else if (me().ready && ops.length) { place = []; upgrades = []; ops = []; selCard = -1; hover = null; sel = null; } // submitted: now on the board
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
      for (const c of placementUnitCenters(s, p, sizeOf(d))) out.push({ side: s, design: d, x: c.x, y: c.y, level: p.level, ...extra });
    };
    for (const p of foe().board) add(opp, p, { selected: sel?.side === opp && sel.uid === p.uid });
    for (const p of me().board) add(side, p, { level: Math.min(MAX_LEVEL, p.level + pendingUps(p.uid)), selected: sel?.side === side && !sel.pending && sel.uid === p.uid });
    if (phase === 'deploy') {
      for (const p of place) add(side, p, { selected: !!sel?.pending && sel.uid === p.uid });
      const d = deck()[selCard];
      if (hover && d) {
        for (const c of placementUnitCenters(side, { x: hover.x, y: hover.y, spacing: hover.spacing }, hover.size)) {
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
    const cells = blockCells(size, p.spacing);
    const wc = localToWorldCell(t.side, p.x, p.y, cells);
    return { col: wc.col, row: wc.row, size: cells, valid: t.side === side };
  }

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
      } else {
        let hov: BoardOverlay['hover'] = null;
        if (hover && phase === 'deploy') {
          const wc = localToWorldCell(side, hover.x, hover.y, hover.cells);
          hov = { col: wc.col, row: wc.row, size: hover.cells, valid: hover.valid };
        } else if (phase === 'deploy' || phase === 'waiting') hov = blockOutline();
        view.drawBoard(boardUnits(), { showZone: phase === 'deploy', hover: hov }, now / 1000);
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
      fieldwrap.removeEventListener('wheel', onWheel, true);
      unsub();
      driver.stop();
      try { view.destroy(); } catch { /* */ }
    },
  };
}
