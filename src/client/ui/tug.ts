// Tug of war screens (shared/tug.ts): the setup page (pick a roster, then play the AI or another person online)
// and the live game (buy blocks from the roster and drop them on your half while the fight runs).
//
// Online games are lockstep: commands go to the server, which stamps each with a tick a little ahead; this screen
// long-polls the order log and simulates the same TugGame as the opponent up to the server's frontier.

import { h, type App, type Screen, type ScreenFn } from '../app.ts';
import { playMusic, sfx } from '../audio.ts';
import { allDesigns, activeDeck } from '../collection.ts';
import {
  NetError, flushTugReports, reportTugGame, tugCommand, tugCreate, tugJoin, tugLeave, tugList, tugPoll, tugQuick, tugResult, type TugRoom,
} from '../net.ts';
import { makeView } from '../render/viewfactory.ts';
import type { BattleView } from '../render/view.ts';
import { applyViewSettings, loadSettings } from '../storage.ts';
import { openModal, paintWhenLaidOut, ringsOf, sizeLabel } from './match-ui.ts';
import { designInfo } from './deckstats.ts';
import { capBadges, renderDeckAnalysis } from './deckpanel.ts';
import * as kit from './kit.ts';
import { liveLine, liveUnitAt, placeTipAt, tipFor, zoomButtons } from './fieldtools.ts';
import { createFpsMeter } from './fps.ts';
import { drawPartIcon } from '../render/field.ts';
import { MODULE_BY_ID } from '../../shared/parts.ts';
import { weaponDps } from '../../shared/stats.ts';
import { aiDeck, type AiDifficulty } from '../../shared/ai.ts';
import { FIELD_H, FIELD_W, MAX_SPACING, STANDARD_FIELD, fmtMeters, hasSpacing, normSpacing, setField } from '../../shared/grid.ts';
import { TICK_RATE } from '../../shared/sim/types.ts';
import { computeStats } from '../../shared/stats.ts';
import {
  TIER_COST, TIER_NAMES, TUG, advance, castleGunPrice, castleGuns, castlePos, blockCenters, dropError, dropZone, incomeCost, incomeRate,
  validateRoster, TugGame, type TugCommand, type TugOrder,
} from '../../shared/tug.ts';
import { TugAi } from '../../shared/tugai.ts';
import type { SimUnit } from '../../shared/sim/types.ts';
import type { Design, ModuleDef, Side, Size } from '../../shared/types.ts';

/** what the game screen plays: the AI locally, or an online room */
export type TugLaunch =
  | { kind: 'ai'; difficulty: AiDifficulty; roster: Design[] }
  | { kind: 'net'; room: TugRoom };

const KEY_ROSTER = 'ab2.tugRoster';
function loadRosterIds(): string[] | null {
  try { const v = JSON.parse(localStorage.getItem(KEY_ROSTER) ?? 'null'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : null; } catch { return null; }
}
function saveRosterIds(ids: string[]): void {
  try { localStorage.setItem(KEY_ROSTER, JSON.stringify(ids)); } catch { /* storage unavailable */ }
}
const costOf = (d: Design) => { try { return computeStats(d).cost; } catch { return Infinity; } };
const sizeOf = (d: Design): Size => { try { return computeStats(d).size; } catch { return 5; } };

/** the saved tug roster, else the active deck (both kept to legal designs that still exist) */
export function tugRoster(): Design[] {
  const all = allDesigns();
  const byId = new Map(all.map((d) => [d.id, d] as const));
  const ids = loadRosterIds();
  const r = (ids ?? []).map((id) => byId.get(id)).filter((d): d is Design => !!d).slice(0, TUG.rosterSize);
  return r.length ? r : activeDeck().slice(0, TUG.rosterSize);
}

// ---------------------------------------------------------------------------------------------------- setup

export const tugSetupScreen: ScreenFn<{ name: 'tug' }> = (app) => {
  playMusic('menu');
  void flushTugReports(); // vs-AI games that could not be reported earlier (offline)
  let roster = tugRoster();
  let busy = false;
  let waitingRoom: TugRoom | null = null;
  let abort: AbortController | null = null;
  let destroyed = false;

  const rosterHost = h('div.tug-roster');
  const statsHost = h('div.db-stats');
  const poolHost = h('div.tug-pool');
  const openHost = h('div.tug-open');
  const status = h('div.tug-status');
  const codeIn = h('input.tug-code', { placeholder: 'Join code', maxlength: '8', autocapitalize: 'characters', spellcheck: 'false' }) as HTMLInputElement;

  const fail = (e: unknown) => { sfx('error'); app.toast(e instanceof Error ? e.message : String(e), 'error'); };
  const rosterOk = (): boolean => {
    const errs = validateRoster(roster);
    if (errs.length) { app.toast(errs[0], 'error'); return false; }
    return true;
  };

  const card = (d: Design, inRoster: boolean): HTMLElement => {
    const cv = h('canvas.tug-thumb');
    paintWhenLaidOut([{ canvas: cv, design: d }]);
    const size = sizeOf(d);
    const info = designInfo(d);
    return h('button.tug-card', {
      class: inRoster ? 'on' : '',
      title: inRoster ? 'Remove from roster' : roster.length >= TUG.rosterSize ? `The roster is full (${TUG.rosterSize})` : 'Add to roster',
      onclick: () => {
        sfx('click');
        if (inRoster) roster = roster.filter((x) => x.id !== d.id);
        else if (roster.length < TUG.rosterSize) roster = [...roster, d];
        else { app.toast(`A roster holds at most ${TUG.rosterSize} designs`, 'error'); return; }
        saveRosterIds(roster.map((x) => x.id));
        renderRoster();
      },
    }, h('span.tug-card-badge', { 'aria-hidden': 'true' }, inRoster ? '✕' : '+'), cv,
      h('div.tug-card-name', null, d.name),
      h('div.tug-card-meta', null, h('span.gold', null, `${costOf(d)}g`), ' · ', h('span', { class: size > TUG.startTier ? 'warn' : 'muted' }, sizeLabel(size))),
      info ? h('div.tug-card-caps', null,
        info.gnd > 0 ? h('span.db-chip.gnd', { title: 'Hits ground units' }, 'GND') : null,
        info.air > 0 ? h('span.db-chip.air', { title: 'Hits aircraft' }, 'AIR') : null,
        capBadges(info)) : null,
    );
  };

  const renderRoster = () => {
    rosterHost.replaceChildren(
      ...roster.map((d) => card(d, true)),
      ...Array.from({ length: TUG.rosterSize - roster.length }, () => h('div.tug-card.empty', null, 'empty')),
    );
    const inR = new Set(roster.map((d) => d.id));
    poolHost.replaceChildren(...allDesigns().filter((d) => !inR.has(d.id)).map((d) => card(d, false)));
    renderDeckAnalysis(statsHost, roster, { slots: TUG.rosterSize, mode: 'tug', title: 'Roster analysis' });
  };

  const go = (launch: TugLaunch) => { if (!destroyed) app.go({ name: 'tugmatch', launch }); };

  /** hold a waiting room open until the opponent joins */
  const waitFor = async (room: TugRoom) => {
    waitingRoom = room;
    renderStatus();
    abort = new AbortController();
    while (!destroyed && waitingRoom === room) {
      try {
        const r = await tugPoll(room.id, -1, 500, abort.signal);
        if (r.status === 'countdown' || r.status === 'live') { waitingRoom = null; sfx('ready'); go({ kind: 'net', room: r }); return; }
        if (r.status === 'done') { waitingRoom = null; renderStatus(); return; }
      } catch (e) {
        if (destroyed || waitingRoom !== room) return;
        if (e instanceof NetError && e.status === 404) { waitingRoom = null; renderStatus(); app.toast('The game was closed', 'error'); return; }
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  };
  const cancelWait = () => {
    const r = waitingRoom;
    waitingRoom = null;
    abort?.abort();
    if (r) void tugLeave(r.id).catch(() => {});
    renderStatus();
  };

  const online = async (fn: () => Promise<TugRoom>) => {
    if (busy || waitingRoom || !rosterOk()) return;
    busy = true;
    renderStatus();
    try {
      const r = await fn();
      busy = false;
      // left the screen while the request was out: close the room we just opened so nobody joins a ghost
      if (destroyed) { if (r.status === 'waiting') void tugLeave(r.id).catch(() => {}); return; }
      if (r.status === 'waiting') void waitFor(r);
      else go({ kind: 'net', room: r });
    } catch (e) { busy = false; renderStatus(); fail(e); }
  };

  const renderStatus = () => {
    if (waitingRoom) {
      status.replaceChildren(h('div.tug-wait', null,
        h('div.spinner'),
        h('div.grow', null,
          h('b', null, 'Waiting for an opponent…'),
          waitingRoom.code ? h('div', null, 'Join code: ', h('b.tug-codeshow', null, waitingRoom.code), h('span.muted', null, ' — share it with a friend')) : null,
        ),
        h('button', { onclick: () => { sfx('click'); cancelWait(); } }, 'Cancel'),
      ));
    } else status.replaceChildren(busy ? h('div.muted', null, 'Connecting…') : '');
  };

  const refreshOpen = async () => {
    try {
      const { open } = await tugList();
      if (destroyed) return;
      openHost.replaceChildren(...(open.length ? open.map((o) => h('div.tug-openrow', null,
        h('span.grow', null, o.name),
        h('button', { onclick: () => { sfx('click'); void online(() => tugJoin(o.id, roster)); } }, 'Join'),
      )) : [h('div.muted', null, 'No open games right now. Find a match and wait for the next player to join.')]));
    } catch (e) {
      openHost.replaceChildren(h('div.muted', null, e instanceof Error ? e.message : 'Offline'));
    }
  };

  const vsAi = (difficulty: AiDifficulty) => () => {
    if (!rosterOk()) return;
    sfx('click');
    go({ kind: 'ai', difficulty, roster });
  };

  // ---- the play panel: TABS pick the opponent kind, CHOICES pick a difficulty, one ACTION starts the game ----
  const KEY_TAB = 'ab2.tugTab', KEY_DIFF = 'ab2.tugDiff';
  const recall = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
  const remember = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };
  let tab: 'ai' | 'online' = recall(KEY_TAB) === 'online' ? 'online' : 'ai';
  let diff: AiDifficulty = (['easy', 'normal', 'hard'] as const).find((d) => d === recall(KEY_DIFF)) ?? 'normal';
  const DIFFS: { v: AiDifficulty; name: string; desc: string }[] = [
    { v: 'easy', name: 'Easy', desc: 'Slow to react, light on economy. Learn the ropes.' },
    { v: 'normal', name: 'Normal', desc: 'Invests, unlocks bigger hulls, answers your pushes.' },
    { v: 'hard', name: 'Hard', desc: 'Fast economy and quick counters. Bring a plan.' },
  ];
  const playPanel = h('section.panel.tug-play');
  const renderPlay = () => {
    const tabBtn = (t: typeof tab, label: string) => h('button.tab', {
      class: tab === t ? 'on' : null, role: 'tab', 'aria-selected': String(tab === t),
      onclick: () => { if (tab !== t) { sfx('click'); tab = t; remember(KEY_TAB, t); renderPlay(); } },
    }, label);
    const body = tab === 'ai'
      ? h('div', { role: 'tabpanel' },
        h('div.choice-label', null, 'Difficulty'),
        h('div.choices', { role: 'radiogroup', 'aria-label': 'Difficulty' }, ...DIFFS.map((d) => h('button.choice', {
          class: diff === d.v ? 'on' : null, role: 'radio', 'aria-checked': String(diff === d.v),
          onclick: () => { sfx('click'); diff = d.v; remember(KEY_DIFF, d.v); renderPlay(); },
        }, h('span.col', { style: { gap: '0' } }, h('span.ch-name', null, d.name), h('span.ch-desc', null, d.desc))))),
        h('button.big.primary.go', { onclick: vsAi(diff) }, `Start vs AI · ${DIFFS.find((d) => d.v === diff)!.name}`),
      )
      : h('div', { role: 'tabpanel' },
        h('button.big.primary.go', { onclick: () => { sfx('click'); void online(() => tugQuick(roster)); }, title: 'Join the oldest open game, or open one and wait for an opponent' }, 'Find a match'),
        h('button.go', { style: { marginTop: '8px' }, onclick: () => { sfx('click'); void online(() => tugCreate(roster, true)); }, title: 'Get a code to share with a friend' }, 'Create private game'),
        h('div.choice-label', { style: { marginTop: '16px' } }, 'Have a code from a friend?'),
        h('div.row', null, codeIn,
          h('button', { onclick: () => { sfx('click'); const c = codeIn.value.trim(); if (c) void online(() => tugJoin(c, roster)); } }, 'Join'),
        ),
        status,
        h('div.choice-label', { style: { marginTop: '16px' } }, 'Open games'),
        openHost,
      );
    playPanel.replaceChildren(h('div.tabbar', { role: 'tablist' }, tabBtn('ai', 'vs AI'), tabBtn('online', 'Multiplayer')), body);
  };
  renderPlay();

  const el = h('div.screen.lobby.tug-setup', null,
    h('div.topbar', null,
      h('button.icon', { onclick: () => { sfx('click'); cancelWait(); app.go({ name: 'menu' }); }, title: 'Back' }, '‹ Back'),
      h('h2', null, 'Tug of War'),
      h('div.spacer'),
    ),
    h('div.screen-scroll.grow', null, h('div.page', null,
      h('p.muted', null,
        'One endless battle on a long, narrow field. Gold flows in every second: spend it on units from your roster and drop them anywhere in your deploy zone — ',
        `after a ${TUG.spawnFreeze} s spawn time (frozen, but already shooting) they march up their lane, fight whatever comes within reach and shell the enemy castle. Invest gold to raise your income, `,
        `or unlock bigger hulls (you start with ${TIER_NAMES[1]} and ${TIER_NAMES[2]}). Destroy the enemy castle to win.`),
      h('div.tug-cols', null,
        h('div.tug-left', null, playPanel, h('section.panel', null, statsHost)),
        h('section.panel.tug-rosterpanel', null,
          h('h3', null, `Tug roster (up to ${TUG.rosterSize})`),
          h('p.muted', null, 'The designs you can buy in Tug of War (separate from your Classic Loadout). ✕ removes one; + below adds one.'),
          rosterHost,
          h('h4', { style: { marginTop: '12px' } }, 'Your designs'),
          poolHost,
        ),
      ),
    )),
  );
  renderRoster();
  renderStatus();
  void refreshOpen();
  const timer = setInterval(() => { if (!waitingRoom) void refreshOpen(); }, 8000);
  return {
    el,
    destroy() {
      destroyed = true;
      clearInterval(timer);
      if (waitingRoom) cancelWait();
    },
  };
};

// ---------------------------------------------------------------------------------------------------- the game

/** castle gun shop filters (kept while the page is open, so reopening the shop keeps them) */
type GunHit = 'all' | 'air' | 'ground' | 'aironly';
type GunSort = 'price' | 'dps' | 'air' | 'range' | 'name';
const gunFilter: { hit: GunHit; minReach: number; sort: GunSort; afford: boolean } = { hit: 'all', minReach: 0, sort: 'price', afford: false };

const MS_PER_TICK = 1000 / TICK_RATE;
/** roughly how long an online order takes to land (the server's lockstep lead) */
const TUG_LEAD_S = 0.8;

export const tugMatchScreen: ScreenFn<{ name: 'tugmatch'; launch: TugLaunch }> = (app, route): Screen => {
  playMusic('battle');
  const L = route.launch;
  const net = L.kind === 'net' ? L.room : null;
  const me: Side = net ? net.side : 0;
  const foe: Side = me === 0 ? 1 : 0;
  const seed = net ? net.seed : (Date.now() & 0x7fffffff) | 1;
  const rosters: [Design[], Design[]] = L.kind === 'net' ? L.room.rosters! : [L.roster, aiDeck(seed, L.difficulty)];
  const names: [string, string] = L.kind === 'net' ? [L.room.names[0] ?? '?', L.room.names[1] ?? '?'] : ['You', `AI (${L.difficulty})`];
  const g = new TugGame(seed, rosters);
  const ai = L.kind === 'ai' ? new TugAi(1, seed ^ 0x5bd1e995, L.difficulty) : null;
  // vs AI: every command applied (both sides, in order, with its tick) so the server can replay the game and learn
  // from its best designs (reportTugGame; online games are already logged by the server)
  const log: TugOrder[] = [];
  const applyLocal = (side: Side, cmd: TugCommand): void => { if (!g.apply(side, cmd)) log.push({ tick: g.tick, side, cmd }); };
  let reported = false;
  /** report a vs-AI game that ran long enough to say something (at its end, or when the player leaves) */
  const reportGame = (): void => {
    if (!ai || reported || g.time < 30) return;
    reported = true;
    void reportTugGame({ seed, rosters, orders: log, endTick: g.tick });
  };
  // handy for debugging in the console (like window.app)
  (window as unknown as { tugGame: TugGame }).tugGame = g;

  // ---- lockstep state (online) ----
  const orders: TugOrder[] = [];
  let nextOrder = 0;
  let frontier = -1;
  /** server tick estimate: the tick in the last poll answer and when it arrived */
  let clockTick = net ? net.tick : 0, clockAt = performance.now();
  let netDown = false;
  let destroyed = false;
  const abort = new AbortController();
  /** my commands sent but not yet applied: their gold is spoken for */
  let inFlight = 0;

  // ---- DOM ----
  const canvas = h('canvas.tug-canvas');
  const overlay = h('canvas.tug-overlay');
  const fieldwrap = h('div.tug-field', null, canvas, overlay);
  const hpBar = (side: Side) => {
    const fill = h('div.tug-hpfill');
    const txt = h('span.tug-hptxt');
    return { el: h('div.tug-hp', { class: side === me ? 'mine' : 'theirs' }, h('div.tug-hpname', null, names[side]), h('div.tug-hpbar', null, fill, txt)), fill, txt };
  };
  const hpMine = hpBar(me), hpFoe = hpBar(foe);
  const clockEl = h('div.tug-clock');
  const goldEl = h('div.tug-gold');
  const netEl = h('div.tug-net');
  const incomeBtn = h('button.tug-eco', { onclick: () => send({ t: 'income' }) });
  const tierBtn = h('button.tug-eco', { onclick: () => send({ t: 'tier' }) });
  const gunBtn = h('button.tug-eco.tug-gunbtn', { title: 'Buy a better gun for your castle (G)', onclick: () => openGunShop() });
  let speed = 1, paused = false;
  const speedBtns = ai ? h('div.row.tug-speed', null,
    ...([0, 1, 2, 4] as const).map((s) => h('button.small', {
      'data-s': String(s),
      onclick: () => { sfx('click'); if (s === 0) paused = !paused; else { speed = s; paused = false; } renderSpeed(); },
    }, s === 0 ? '❚❚' : `${s}×`)),
  ) : null;
  const renderSpeed = () => speedBtns?.querySelectorAll('button').forEach((b) => {
    const s = Number((b as HTMLElement).dataset.s);
    b.classList.toggle('on', s === 0 ? paused : !paused && speed === s);
  });
  const cardsEl = h('div.tug-cards');
  const hint = h('div.tug-hint');
  const el = h('div.screen.tug-match', null,
    h('div.tug-top', null,
      h('button.icon', { title: 'Surrender and leave', onclick: () => void quit() }, '‹'),
      hpMine.el, clockEl, hpFoe.el, netEl, speedBtns,
    ),
    fieldwrap,
    hint,
    h('div.tug-bottom', null,
      h('div.tug-econ', null, goldEl, incomeBtn, tierBtn, gunBtn),
      cardsEl,
    ),
  );

  let view: BattleView;
  try { view = makeView(canvas, me); } catch (e) { console.error(e); app.toast('Could not start the battlefield renderer', 'error'); throw e; }
  applyViewSettings(view, loadSettings());
  view.controls.doubleClickZoom = false;
  // an endless battle has no end of round to clear the field: wrecks fade / sink away after a while
  view.wreckLife = TUG_WRECK_LIFE;
  // the same field controls as a match and the playground: wheel / pinch zoom, drag / WASD pan, right-drag (Ctrl /
  // Option + drag), two-finger twist or Q / E to turn the 3D view, +/- and F, and the zoom buttons
  view.controls.rotate = !!view.canRotate;
  fieldwrap.append(zoomButtons(view));

  // ---- roster cards ----
  let sel = -1, rot = false;
  /** squad spacing per roster design (mouse wheel / [ ] while its card is picked), kept between drops */
  const spacingOf = new Map<string, number>();
  const selSquad = (): boolean => sel >= 0 && hasSpacing(computeStats(cards[sel].d));
  /** the pointer is over our own deploy zone with the picked card's block on the field (else: no drop preview) */
  const hoverInZone = (): boolean => {
    if (sel < 0 || !hover) return false;
    const err = dropError(me, cards[sel].d, hover.x, hover.y, rot && computeStats(cards[sel].d).squad > 1, curSpacing());
    return err !== 'Only in your own deploy zone' && err !== 'Off the field';
  };
  const curSpacing = (): number => (sel >= 0 ? normSpacing(computeStats(cards[sel].d), spacingOf.get(cards[sel].d.id)) : 0);
  /** the buy command for the picked card dropped at (x, y), with its rotation and spacing */
  const buyCmd = (x: number, y: number): Extract<TugCommand, { t: 'buy' }> => {
    const sp = curSpacing();
    return { t: 'buy', designId: cards[sel].d.id, x, y, ...(rot ? { rot: true } : {}), ...(sp ? { spacing: sp } : {}) };
  };
  function stepSpacing(dir: number): boolean {
    if (!selSquad()) return false;
    const d = cards[sel].d, cur = curSpacing(), next = Math.max(0, Math.min(MAX_SPACING, cur + dir));
    if (next === cur) return true;
    spacingOf.set(d.id, next);
    sfx('click');
    renderWheelSign();
    return true;
  }
  const cards: { el: HTMLElement; d: Design; cost: HTMLElement; cd: HTMLElement }[] = [];
  /** online: designs bought but not yet in the game: when (performance.now ms) their cooldown runs out, and its length (s) */
  const localReady = new Map<string, { at: number; len: number }>();
  /** seconds until this design can be bought again */
  const cooldownLeft = (id: string): number => Math.max(g.cooldown(me, id) / TICK_RATE, ((localReady.get(id)?.at ?? 0) - performance.now()) / 1000);
  /** length (s) of this design's running cooldown */
  const cooldownLen = (id: string): number => Math.max((g.sides[me].cdLen[id] ?? 0) / TICK_RATE, localReady.get(id)?.len ?? 0);
  rosters[me].forEach((d, i) => {
    const cv = h('canvas.tug-thumb');
    const cost = h('span.gold');
    const cd = h('span.tug-cd', { 'aria-hidden': 'true' });
    const st = computeStats(d);
    const c = h('button.tug-unit', {
      'aria-label': `${d.name} — ${st.cost}g, ${sizeLabel(st.size)}${st.squad > 1 ? `, squad of ${st.squad}` : ''}  [${i + 1}]`,
      onclick: () => { sfx('click'); sel = sel === i ? -1 : i; renderCards(); },
    }, cv, cd, h('div.tug-unit-name', null, d.name), h('div.tug-unit-meta', null, cost, st.squad > 1 ? h('span.muted', null, ` ×${st.squad}`) : null), h('kbd.tug-key', null, String(i + 1)));
    cards.push({ el: c, d, cost, cd });
    cardsEl.append(c);
    paintWhenLaidOut([{ canvas: cv, design: d }]); // friendly colours, like our units on the field
  });

  /** gold I can still spend now (the server has my in-flight commands, the game hasn't applied them yet) */
  const pendingSpend = (): number => {
    let s = 0;
    for (let i = nextOrder; i < orders.length; i++) {
      const o = orders[i];
      if (o.side !== me) continue;
      const c = o.cmd;
      if (c.t === 'buy') { const d = g.design(me, c.designId); if (d) s += costOf(d); }
      else if (c.t === 'income') s += incomeCost(g.sides[me].incomeLvl);
      else if (c.t === 'tier') { const nt = g.nextTier(me); if (nt) s += TIER_COST[nt]; }
      else if (c.t === 'castleGun') { const m = MODULE_BY_ID.get(c.moduleId); if (m) s += castleGunPrice(m); }
    }
    return s + inFlight;
  };
  const spendable = () => g.sides[me].gold - pendingSpend();

  const renderCards = () => {
    const S = g.sides[me], gold = spendable();
    cards.forEach((c, i) => {
      const st = computeStats(c.d);
      const locked = st.size > S.tier;
      c.el.classList.toggle('sel', i === sel);
      c.el.classList.toggle('locked', locked);
      c.el.classList.toggle('poor', !locked && st.cost > gold);
      c.cost.textContent = locked ? `🔒 ${TIER_NAMES[st.size]}` : `${st.cost}g`;
      // cooldown: a dark wedge sweeping round the card, with the seconds left
      const left = locked ? 0 : cooldownLeft(c.d.id);
      c.el.classList.toggle('cooling', left > 0);
      c.cd.style.setProperty('--cd', String(left > 0 ? Math.min(1, left / Math.max(left, cooldownLen(c.d.id))) : 0));
      c.cd.textContent = left > 0 ? String(Math.ceil(left)) : '';
    });
    const gun = MODULE_BY_ID.get(S.castleGun);
    gunBtn.replaceChildren(h('span', null, 'Castle gun ▸'), h('small.muted', null, gun?.name ?? S.castleGun));
    goldEl.replaceChildren(h('b.gold', null, `${Math.floor(gold)}g`), h('span.muted', null, ` +${incomeRate(S.incomeLvl)}/s`));
    if (S.incomeLvl >= TUG.maxIncomeLevel) { incomeBtn.textContent = 'Income maxed'; incomeBtn.disabled = true; }
    else {
      const c = incomeCost(S.incomeLvl);
      incomeBtn.replaceChildren(h('span', null, `Invest +${TUG.incomeStep}/s`), h('small.gold', null, ` ${c}g`));
      incomeBtn.disabled = gold < c || g.done;
    }
    const nt = g.nextTier(me);
    if (nt === null) {
      // nothing bigger in the roster: no upgrade to sell
      tierBtn.textContent = S.tier >= TUG.maxTier ? 'All hulls unlocked' : 'No bigger hulls';
      tierBtn.title = S.tier >= TUG.maxTier ? '' : 'Your roster has no bigger designs to unlock';
      tierBtn.disabled = true;
    } else {
      const c = TIER_COST[nt];
      tierBtn.title = nt > S.tier + 1 ? `Your roster has no ${TIER_NAMES[(S.tier + 1) as Size]} designs, so this goes straight to ${TIER_NAMES[nt]} (U)` : `Unlock ${TIER_NAMES[nt]} hulls (U)`;
      tierBtn.replaceChildren(h('span', null, `Unlock ${TIER_NAMES[nt]}`), h('small.gold', null, ` ${c}g`));
      tierBtn.disabled = gold < c || g.done;
    }
  };

  // ---- castle gun shop: every weapon a castle can carry, cheapest first ----
  let shop: { close(): void } | null = null;
  function openGunShop(): void {
    if (g.done || shop) return;
    sfx('click');
    const rows: { b: HTMLButtonElement; m: ModuleDef; price: number; dps: number; air: number; range: number }[] = [];
    const cur = h('p');
    const r0 = h('p.bad.gunshop-err');
    const list = h('div.gunshop');
    const bar = h('div.gunshop-bar');
    const count = h('span.gunshop-count.muted');
    const guns = castleGuns();
    const maxReach = Math.ceil(Math.max(...guns.map((m) => m.range ?? 0)));
    for (const m of guns) {
      const price = castleGunPrice(m), dps = weaponDps(m), air = m.targetsAir ? dps * (m.airBonus ?? 1) : 0, range = m.range ?? 0;
      const icon = h('canvas.gunshop-icon', { width: '96', height: '96' }) as HTMLCanvasElement;
      try { drawPartIcon(icon, 'module', m.id, { backdrop: true }); } catch { /* icon is decoration */ }
      const tags = [
        m.splash ? `splash ${fmtMeters(m.splash)}` : '', m.pierce ? 'pierce' : '', m.chain ? `chain ×${m.chain}` : '',
        m.stun ? 'stun' : '', m.slow ? 'slow' : '', m.burn ? 'burn' : '', m.projectile === 'missile' ? 'homing' : '',
      ].filter(Boolean);
      const b = h('button.gunshop-card', {
        onclick: () => {
          const err = checkSpendable({ t: 'castleGun', moduleId: m.id });
          if (err) { sfx('error'); r0.textContent = err; return; }
          send({ t: 'castleGun', moduleId: m.id });
          close();
        },
      }, icon,
        h('span.gunshop-name', null, m.name),
        h('span.gunshop-hits', null,
          h('span.sc-chip', { class: m.targetsGround ? 'g' : 'off' }, 'GND'),
          h('span.sc-chip', { class: m.targetsAir ? 'a' : 'off' }, 'AIR')),
        h('span.gunshop-stats', null,
          h('b', null, fmtMeters(range)), m.minRange ? h('span.min', null, ` (min ${fmtMeters(m.minRange)})`) : null, ' · ',
          h('b', null, String(Math.round(dps))), ' dps',
          m.targetsAir && (m.airBonus ?? 1) > 1 ? h('span.air', null, ` · ${Math.round(air)} vs air`) : null),
        tags.length ? h('span.gunshop-tags', null, tags.join(' · ')) : null,
        h('span.gunshop-price.gold', null, `${price}g`), h('span.gunshop-need')) as HTMLButtonElement;
      rows.push({ b, m, price, dps, air, range });
    }
    const SORTS: Record<GunSort, (a: (typeof rows)[number], b: (typeof rows)[number]) => number> = {
      price: (a, b) => a.price - b.price, dps: (a, b) => b.dps - a.dps, air: (a, b) => b.air - a.air,
      range: (a, b) => b.range - a.range, name: (a, b) => a.m.name.localeCompare(b.m.name),
    };
    const relist = () => {
      const f = gunFilter, gold = spendable();
      const shown = rows.filter((r) => {
        const m = r.m;
        if (f.hit === 'air' && !m.targetsAir) return false;
        if (f.hit === 'ground' && !m.targetsGround) return false;
        if (f.hit === 'aironly' && (!m.targetsAir || m.targetsGround)) return false;
        if (r.range < f.minReach) return false;
        if (f.afford && r.price > gold && m.id !== g.sides[me].castleGun) return false;
        return true;
      }).sort((a, b) => SORTS[f.sort](a, b) || a.price - b.price);
      list.replaceChildren(...shown.map((r) => r.b), ...(shown.length ? [] : [h('p.muted.gunshop-none', null, 'No gun matches these filters.')]));
      count.textContent = `${shown.length} of ${rows.length} guns`;
    };
    const renderBar = () => {
      const f = gunFilter;
      const set = (patch: Partial<typeof gunFilter>) => { Object.assign(gunFilter, patch); renderBar(); relist(); };
      bar.replaceChildren(
        kit.segmented<GunHit>({
          value: f.hit, label: 'What it hits', onChange: (v) => set({ hit: v }),
          options: [{ value: 'all', label: 'All' }, { value: 'air', label: 'Hits air' }, { value: 'ground', label: 'Hits ground' }, { value: 'aironly', label: 'Air only' }],
        }),
        h('label.gunshop-reach', null, h('span', null, 'Min reach'), kit.slider({
          value: f.minReach, min: 0, max: maxReach, step: 1, label: 'Minimum reach',
          format: (v) => (v ? `≥ ${fmtMeters(v)}` : 'any'), onInput: (v) => { gunFilter.minReach = v; relist(); },
        })),
        kit.select<GunSort>({
          value: f.sort, prefix: 'Sort', label: 'Sort by', onChange: (v) => set({ sort: v }),
          options: [{ value: 'price', label: 'Price' }, { value: 'dps', label: 'DPS' }, { value: 'air', label: 'DPS vs air' }, { value: 'range', label: 'Range' }, { value: 'name', label: 'Name' }],
        }),
        kit.toggle({ label: 'Affordable', on: f.afford, onChange: (v) => set({ afford: v }), title: 'Only guns you can buy now' }),
        count,
      );
    };
    const refresh = () => {
      const gold = spendable(), mine = g.sides[me].castleGun;
      cur.replaceChildren('Your castle has a ', h('b', null, MODULE_BY_ID.get(mine)?.name ?? mine), `. Buying a gun replaces it (the old one is not refunded). You have `, h('b.gold', null, `${Math.floor(gold)}g`), '.');
      for (const r of rows) {
        const on = r.m.id === mine;
        r.b.classList.toggle('on', on);
        r.b.classList.toggle('poor', !on && r.price > gold);
        r.b.disabled = on;
        r.b.title = on ? 'Equipped' : r.price > gold ? `Need ${Math.ceil(r.price - gold)}g more` : `Buy for ${r.price}g`;
        r.b.querySelector('.gunshop-need')!.textContent = !on && r.price > gold ? `need ${Math.ceil(r.price - gold)}g more` : '';
      }
      if (gunFilter.afford) relist();
    };
    renderBar();
    relist();
    refresh();
    const timer = window.setInterval(refresh, 300);
    const handle = openModal('Castle gun', h('div', null, cur, r0, bar, list));
    const close = () => { window.clearInterval(timer); handle.close(); shop = null; };
    // the modal closes itself too (Close button, backdrop, Esc): stop refreshing then
    const obs = new MutationObserver(() => { if (!handle.el.isConnected) { window.clearInterval(timer); shop = null; obs.disconnect(); } });
    obs.observe(document.body, { childList: true });
    shop = { close };
  }

  // ---- commands ----
  function send(cmd: TugCommand): void {
    if (g.done) return;
    // check against what we can spend (gold spoken for by commands on their way doesn't count)
    const err = cmd.t === 'surrender' ? null : checkSpendable(cmd);
    if (err) { sfx('error'); flashHint(err); return; }
    sfx(cmd.t === 'buy' ? 'place' : 'click');
    if (!net) { applyLocal(me, cmd); renderCards(); return; }
    const cost = cmd.t === 'buy' ? costOf(g.design(me, cmd.designId)!) : cmd.t === 'income' ? incomeCost(g.sides[me].incomeLvl)
      : cmd.t === 'tier' ? TIER_COST[g.nextTier(me) ?? 1] : cmd.t === 'castleGun' ? castleGunPrice(MODULE_BY_ID.get(cmd.moduleId)!) : 0;
    inFlight += cost;
    if (cmd.t === 'buy') {
      ghosts.push({ cmd, at: performance.now() });
      // the cooldown starts now on this screen (the game starts it when the order lands, ~1 s later); it lasts longer
      // the more blocks of this design are already on the field
      const len = g.nextCooldown(me, cmd.designId) + TUG_LEAD_S;
      localReady.set(cmd.designId, { at: performance.now() + len * 1000, len });
    }
    if (cmd.t !== 'buy') renderCards();
    tugCommand(net.id, cmd).then(() => { inFlight -= cost; }, (e) => { inFlight -= cost; flashHint(e instanceof Error ? e.message : 'Command failed'); });
  }
  function checkSpendable(cmd: TugCommand): string | null {
    if (cmd.t === 'buy') {
      const left = cooldownLeft(cmd.designId);
      if (left > 0) return `${g.design(me, cmd.designId)?.name ?? 'That design'} is ready again in ${Math.ceil(left)} s`;
    }
    const pend = pendingSpend();
    const S = g.sides[me];
    const saved = S.gold;
    S.gold -= pend;
    try { return g.check(me, cmd); } finally { S.gold = saved; }
  }

  let hintTimer = 0;
  const flashHint = (msg: string) => {
    hint.textContent = msg;
    hint.classList.add('show');
    clearTimeout(hintTimer);
    hintTimer = window.setTimeout(() => { hintTimer = 0; hint.classList.remove('show'); }, 1600);
  };

  // drops sent to the server and not yet in the game (drawn as outlines)
  const ghosts: { cmd: Extract<TugCommand, { t: 'buy' }>; at: number }[] = [];

  // ---- pointer ----
  let hover: { x: number; y: number } | null = null;
  const local = (e: PointerEvent) => { const r = canvas.getBoundingClientRect(); return { px: e.clientX - r.left, py: e.clientY - r.top }; };
  const toWorld = (e: PointerEvent) => { const { px, py } = local(e); try { return view.screenToWorld(px, py); } catch { return null; } };
  canvas.addEventListener('pointermove', (e) => {
    hover = toWorld(e);
    wheelPos = { x: e.clientX, y: e.clientY };
    renderWheelSign();
    // hovering a unit (mouse, nothing picked to drop): its weapon ranges are drawn round it (click for its card)
    if (e.pointerType !== 'mouse' || sel >= 0 || view.wasDrag || e.buttons) { ringId = -1; return; }
    const { px, py } = local(e);
    ringId = liveUnitAt(view, g.battle, px, py)?.id ?? -1;
  });
  canvas.addEventListener('pointerleave', () => { hover = null; wheelPos = null; renderWheelSign(); ringId = -1; });
  // a little sign by the cursor while a squad is about to be dropped: the wheel opens / closes its formation
  const wheelSign = h('div.tug-wheel', { 'aria-hidden': 'true' });
  fieldwrap.append(wheelSign);
  let wheelPos: { x: number; y: number } | null = null;
  function renderWheelSign(): void {
    const on = !!wheelPos && selSquad() && hoverInZone() && window.matchMedia('(hover: hover)').matches;
    wheelSign.classList.toggle('show', on);
    if (!on) return;
    const sp = curSpacing();
    wheelSign.replaceChildren(
      h('span.tug-wheel-ico', null, '🖱'),
      h('span', null, 'Shift + wheel: spacing'),
      h('b', null, sp ? fmtMeters(sp) : 'tight'),
      h('span.tug-wheel-dots', null, ...Array.from({ length: MAX_SPACING + 1 }, (_, i) => h('i', { class: i <= sp ? 'on' : '' }))));
    const fr = fieldwrap.getBoundingClientRect();
    wheelSign.style.left = `${wheelPos!.x - fr.left + 18}px`;
    wheelSign.style.top = `${wheelPos!.y - fr.top + 18}px`;
  }
  canvas.addEventListener('pointerup', (e) => {
    if (view.wasDrag || e.button > 0) return;
    if (sel < 0) {
      // no card picked: click a unit to pin its stats (live hp + damage), click empty ground to close
      const { px, py } = local(e);
      const u = liveUnitAt(view, g.battle, px, py);
      if (u) { showLiveTip(u, { x: e.clientX, y: e.clientY }); sfx('click'); } else hideTip();
      return;
    }
    const w = toWorld(e);
    if (!w) return;
    send(buyCmd(w.x, w.y));
  });
  canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); if (sel >= 0 && !view.wasDrag) { sel = -1; renderCards(); } });
  const onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    const n = Number(e.key);
    if (n >= 1 && n <= cards.length) { sel = sel === n - 1 ? -1 : n - 1; renderCards(); }
    else if (e.key === 'Escape') { if (tipEl && sel < 0) hideTip(); sel = -1; renderCards(); }
    else if (e.key === 'r' || e.key === 'R') rot = !rot;
    else if ((e.key === '[' || e.key === ']') && !e.ctrlKey && !e.metaKey && !e.altKey) { if (stepSpacing(e.key === ']' ? 1 : -1)) e.preventDefault(); }
    else if (e.key === 'i' || e.key === 'I') send({ t: 'income' });
    else if (e.key === 'u' || e.key === 'U') send({ t: 'tier' });
    else if (e.key === 'g' || e.key === 'G') openGunShop();
    else if (e.key === ' ' && ai) { paused = !paused; renderSpeed(); e.preventDefault(); }
  };
  window.addEventListener('keydown', onKey);
  // while a squad card is picked Shift + wheel sets its spacing (captured before the camera's wheel zoom sees it);
  // the plain wheel keeps zooming the map
  let wheelAt = 0;
  const onWheel = (e: WheelEvent) => {
    if (!selSquad() || !e.shiftKey || e.ctrlKey) return;
    e.preventDefault();
    e.stopPropagation();
    const dy = e.deltaY || e.deltaX, now = performance.now();
    if (!dy || now - wheelAt < 110) return; // one step per notch, not per trackpad tick
    wheelAt = now;
    stepSpacing(dy < 0 ? 1 : -1);
  };
  fieldwrap.addEventListener('wheel', onWheel, { capture: true, passive: false });
  const onResize = () => { try { view.resize(); } catch { /* */ } };
  window.addEventListener('resize', onResize);

  // ---- inspect: a clicked unit's stat card, pinned where it was clicked, its hp / damage kept live ----
  let tipEl: HTMLElement | null = null;
  let tipId = -1, tipT = 0;
  function hideTip(): void { tipEl?.remove(); tipEl = null; tipId = -1; }
  function showLiveTip(u: SimUnit, at: { x: number; y: number }): void {
    hideTip();
    const mine = u.side === me;
    tipEl = tipFor(u.design, u.stats, u.level, mine ? 'Yours' : 'Enemy', mine, normSpacing(u.stats, undefined), undefined, liveLine(g.battle, u));
    fieldwrap.append(tipEl);
    tipId = u.id;
    placeTipAt(tipEl, fieldwrap, at, { w: tipEl.offsetWidth, h: tipEl.offsetHeight });
  }
  /** the unit whose weapon ranges are drawn: the hovered one (else the one whose card is pinned) */
  let ringId = -1;
  /** its weapon / support rings on the ground (perspective-correct: each ring is traced through the camera) */
  const drawUnitRings = () => {
    const id = ringId >= 0 ? ringId : tipId;
    const u = id >= 0 ? g.battle.units.find((q) => q.id === id) : undefined;
    if (!u || !u.alive) return;
    const ring = (r: number) => {
      octx.beginPath();
      for (let a = 0; a <= 48; a++) {
        const p = view.worldToScreen(u.x + Math.cos((a / 48) * Math.PI * 2) * r, u.y + Math.sin((a / 48) * Math.PI * 2) * r);
        if (a) octx.lineTo(p.x, p.y); else octx.moveTo(p.x, p.y);
      }
      octx.closePath();
    };
    const rings = ringsOf(u.design, u.stats).sort((a, b) => b.range - a.range);
    for (const rg of rings) {
      ring(rg.range);
      octx.globalAlpha = rg.kind === 'support' ? 0.05 : 0.09;
      octx.fillStyle = rg.color;
      octx.fill();
      octx.globalAlpha = 0.95;
      octx.strokeStyle = rg.color;
      octx.lineWidth = 2;
      octx.stroke();
      if (rg.minRange > 0) { ring(rg.minRange); octx.globalAlpha = 0.22; octx.fillStyle = '#000'; octx.fill(); }
      octx.globalAlpha = 1;
      // label at the ring's far side (toward the enemy)
      const fy = u.side === 0 ? -1 : 1, lp = view.worldToScreen(u.x, u.y + fy * rg.range);
      octx.font = '600 12px Barlow, system-ui, sans-serif';
      octx.textAlign = 'center';
      octx.textBaseline = 'middle';
      octx.lineWidth = 3;
      octx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
      octx.strokeText(rg.label, lp.x, lp.y);
      octx.fillStyle = rg.color;
      octx.fillText(rg.label, lp.x, lp.y);
    }
  };
  function refreshTip(dt: number): void {
    if (!tipEl) return;
    tipT += dt;
    if (tipT < 0.2) return;
    tipT = 0;
    // wrecks are cleared from an endless battle after a while: the card goes with them
    const u = g.battle.units.find((q) => q.id === tipId);
    const old = tipEl.querySelector('.sc-live');
    if (!u) hideTip();
    else if (old) old.replaceWith(liveLine(g.battle, u));
  }

  // ---- overlay: drop zone, the block under the cursor, pending drops ----
  const octx = overlay.getContext('2d')!;
  const quad = (x0: number, y0: number, x1: number, y1: number) => {
    const p = [view.worldToScreen(x0, y0), view.worldToScreen(x1, y0), view.worldToScreen(x1, y1), view.worldToScreen(x0, y1)];
    octx.beginPath();
    octx.moveTo(p[0].x, p[0].y);
    for (let i = 1; i < 4; i++) octx.lineTo(p[i].x, p[i].y);
    octx.closePath();
  };
  const drawBlock = (d: Design, x: number, y: number, r: boolean, ok: boolean, alpha: number, sp = 0) => {
    const st = computeStats(d);
    const fw = st.fw, fh = st.fh;
    octx.fillStyle = ok ? `rgba(80, 220, 140, ${0.35 * alpha})` : `rgba(240, 80, 70, ${0.35 * alpha})`;
    octx.strokeStyle = ok ? `rgba(120, 255, 170, ${alpha})` : `rgba(255, 110, 90, ${alpha})`;
    octx.lineWidth = 1.5;
    for (const c of blockCenters(me, d, x, y, r && st.squad > 1, normSpacing(st, sp))) {
      quad(c.x - fw / 2, c.y - fh / 2, c.x + fw / 2, c.y + fh / 2);
      octx.fill();
      octx.stroke();
    }
  };
  /** freshly dropped blocks: a ring that empties as their spawn freeze runs out, with the seconds left */
  const drawFrozen = () => {
    const freezeTicks = TUG.spawnFreeze * TICK_RATE;
    for (const sp of g.spawns) {
      let n = 0, cx = 0, cy = 0, ext = 0;
      for (const id of sp.ids) { const u = g.battle.units[id]; if (u.alive) { n++; cx += u.x; cy += u.y; } }
      if (!n) continue;
      cx /= n; cy /= n;
      for (const id of sp.ids) { const u = g.battle.units[id]; if (u.alive) ext = Math.max(ext, Math.hypot(u.x - cx, u.y - cy) + Math.max(u.stats.fw, u.stats.fh) / 2); }
      const c = view.worldToScreen(cx, cy), e = view.worldToScreen(cx + ext + 0.8, cy);
      const R = Math.max(10, Math.hypot(e.x - c.x, e.y - c.y));
      const left = Math.max(0, sp.until - g.tick) / freezeTicks;
      const col = sp.side === me ? '63, 182, 232' : '255, 106, 61';
      octx.lineWidth = 3;
      octx.strokeStyle = `rgba(${col}, 0.25)`;
      octx.beginPath(); octx.arc(c.x, c.y, R, 0, Math.PI * 2); octx.stroke();
      octx.strokeStyle = `rgba(${col}, 0.9)`;
      octx.beginPath(); octx.arc(c.x, c.y, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left); octx.stroke();
      octx.font = '600 13px Barlow, system-ui, sans-serif';
      octx.textAlign = 'center';
      octx.textBaseline = 'middle';
      octx.lineWidth = 3;
      octx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
      const t = String(Math.ceil(Math.max(0, sp.until - g.tick) / TICK_RATE));
      octx.strokeText(t, c.x, c.y - R - 9);
      octx.fillStyle = `rgb(${col})`;
      octx.fillText(t, c.x, c.y - R - 9);
    }
  };
  const drawOverlay = () => {
    const r = overlay.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
    if (overlay.width !== W || overlay.height !== H) { overlay.width = W; overlay.height = H; }
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, W, H);
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (g.done) return;
    drawFrozen();
    drawUnitRings();
    // our deploy zone: a faint outline always (so it's learnt), lit up with the castle's no-drop circle while a
    // card is picked
    {
      const z = dropZone(me), on = sel >= 0;
      quad(z.x0 + 0.15, z.y0 + 0.15, z.x1 - 0.15, z.y1 - 0.15);
      octx.fillStyle = `rgba(63, 182, 232, ${on ? 0.14 : 0.03})`;
      octx.fill();
      octx.setLineDash(on ? [] : [6, 6]);
      octx.strokeStyle = `rgba(63, 182, 232, ${on ? 0.95 : 0.35})`;
      octx.lineWidth = on ? 2.5 : 1.5;
      octx.stroke();
      octx.setLineDash([]);
      if (on) {
        // label on the zone's front edge
        const front = me === 0 ? z.y0 : z.y1, lp = view.worldToScreen((z.x0 + z.x1) / 2, front + (me === 0 ? 1.2 : -1.2));
        octx.font = '700 13px Barlow, system-ui, sans-serif';
        octx.textAlign = 'center';
        octx.textBaseline = 'middle';
        octx.lineWidth = 3;
        octx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
        octx.strokeText('DEPLOY ZONE', lp.x, lp.y);
        octx.fillStyle = 'rgb(120, 210, 245)';
        octx.fillText('DEPLOY ZONE', lp.x, lp.y);
        // the castle itself: no drops on it
        const c = castlePos(me), R = 3.5 + 0.4, pts: { x: number; y: number }[] = [];
        for (let a = 0; a <= 32; a++) pts.push(view.worldToScreen(c.x + Math.cos((a / 32) * Math.PI * 2) * R, c.y + Math.sin((a / 32) * Math.PI * 2) * R));
        octx.beginPath();
        pts.forEach((p, i) => (i ? octx.lineTo(p.x, p.y) : octx.moveTo(p.x, p.y)));
        octx.closePath();
        octx.fillStyle = 'rgba(240, 80, 70, 0.12)';
        octx.fill();
        octx.setLineDash([5, 5]);
        octx.strokeStyle = 'rgba(255, 110, 90, 0.8)';
        octx.lineWidth = 1.5;
        octx.stroke();
        octx.setLineDash([]);
      }
    }
    if (sel >= 0) {
      if (hover && hoverInZone()) {
        const d = cards[sel].d;
        const ok = !checkSpendable(buyCmd(hover.x, hover.y));
        drawBlock(d, hover.x, hover.y, rot, ok, 1, curSpacing());
      }
    }
    const now = performance.now();
    for (let i = ghosts.length - 1; i >= 0; i--) {
      const gh = ghosts[i];
      if (now - gh.at > TUG_GHOST_MS) { ghosts.splice(i, 1); continue; }
      const d = g.design(me, gh.cmd.designId);
      if (d) drawBlock(d, gh.cmd.x, gh.cmd.y, !!gh.cmd.rot, true, 0.5 + 0.3 * Math.sin(now / 90), gh.cmd.spacing ?? 0);
    }
  };

  // ---- HUD ----
  const renderHud = () => {
    for (const [bar, s] of [[hpMine, me], [hpFoe, foe]] as const) {
      const hp = g.castleHp(s);
      bar.fill.style.width = `${(100 * hp) / TUG.castleHp}%`;
      bar.txt.textContent = `${Math.ceil(hp).toLocaleString()} · ${g.aliveCount(s)} units`;
    }
    const t = Math.floor(g.time);
    clockEl.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    clockEl.classList.toggle('overtime', g.overtime);
    clockEl.title = g.overtime ? `Overtime: both castles crumble by ${TUG.overtimeDecay} hp/s` : `Overtime starts at ${TUG.overtimeAt / 60}:00`;
    netEl.textContent = net && netDown ? 'reconnecting…' : '';
    // the placement hint stays up while a card is picked (a refusal flashes over it for a moment)
    if (sel >= 0 && !hintTimer) {
      hint.textContent = `Click your deploy zone to drop ${cards[sel].d.name}${computeStats(cards[sel].d).squad > 1 ? ' · Shift + wheel / [ ] spacing · R rotates' : ''} · right-click / Esc cancels · right-drag turns the view`;
      hint.classList.add('show');
    } else if (sel < 0 && !hintTimer) hint.classList.remove('show');
    if (sel >= 0 && tipEl) hideTip(); // picking a card to drop closes an inspected unit's card
    renderWheelSign();
    renderCards();
  };

  // ---- online: poll the order log ----
  const pollLoop = async () => {
    if (!net) return;
    if (net.orders.length) { orders.push(...net.orders); }
    frontier = net.frontier;
    while (!destroyed) {
      try {
        const sentAt = performance.now();
        const r = await tugPoll(net.id, orders.length, 500, abort.signal);
        if (destroyed) return;
        netDown = false;
        // only the orders we don't have yet (the reply starts at the index we asked from)
        const have = orders.length;
        const start = r.total - r.orders.length;
        for (let i = Math.max(0, have - start); i < r.orders.length; i++) orders.push(r.orders[i]);
        frontier = Math.max(frontier, r.frontier);
        const recv = performance.now();
        // half the round trip after the server's reading: its clock now
        clockTick = r.tick + (recv - sentAt) / 2 / MS_PER_TICK;
        clockAt = recv;
        if (r.status === 'done' && r.winner !== null && !g.done && orders.length === r.total && g.tick >= frontier) {
          // the other side saw the end (or we were away too long): nothing more will come
          finishedByServer = r.winner;
        }
      } catch (e) {
        if (destroyed) return;
        netDown = true;
        if (e instanceof NetError && e.status === 404) { endNote = 'The game is gone from the server.'; finishedByServer = -1; return; }
        await new Promise((res) => setTimeout(res, 800));
      }
    }
  };
  let finishedByServer: Side | -1 | null = null;
  let endNote = '';
  void pollLoop();

  // ---- main loop ----
  let raf = 0, last = performance.now(), acc = 0, hudT = 0, ended = false;
  view.fit(true);
  const fps = createFpsMeter(fieldwrap);
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    fps.tick(now);
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    try {
      if (!g.done) {
        if (net) {
          const target = Math.min(frontier, Math.floor(clockTick + (now - clockAt) / MS_PER_TICK) - 1);
          if (target > g.tick) {
            // catch up quickly after a stall, but never more than a burst of ticks per frame
            nextOrder = advance(g, orders, nextOrder, Math.min(target, g.tick + 30), () => view.pushEvents(g.battle.events));
          }
        } else if (!paused) {
          acc += dt * TICK_RATE * speed;
          let n = 0;
          const t0 = performance.now(); // time budget: a heavy tick must slow the game, not freeze frames
          while (acc >= 1 && !g.done && n++ < 40 && performance.now() - t0 < 12) {
            for (const c of ai!.think(g)) applyLocal(1, c);
            g.step();
            view.pushEvents(g.battle.events);
            acc -= 1;
          }
          if (acc > 4) acc = 4;
        }
      }
      view.drawBattle(g.battle, dt);
      drawOverlay();
      refreshTip(dt);
    } catch (e) { console.error('[tug] frame failed', e); }
    hudT -= dt;
    if (hudT <= 0) { hudT = 0.1; renderHud(); }
    if (!ended && (g.done || finishedByServer !== null)) { ended = true; void showEnd(); }
  };
  raf = requestAnimationFrame(frame);

  // ---- end ----
  const showEnd = async () => {
    const w = g.winner ?? finishedByServer ?? -1;
    if (net && g.done) void tugResult(net.id, w).catch(() => {});
    reportGame();
    sfx(w === me ? 'victory' : 'defeat');
    const title = w === me ? 'Victory' : w === -1 ? 'Draw' : 'Defeat';
    const S = g.sides[me];
    const box = h('div.tug-end', null,
      h('h1', { class: w === me ? 'good' : w === -1 ? '' : 'bad' }, title),
      h('p', null, g.surrendered !== null ? (g.surrendered === me ? 'You surrendered.' : `${names[foe]} surrendered.`) : w === me ? 'The enemy castle has fallen.' : w === -1 ? '' : 'Your castle has fallen.'),
      endNote ? h('p.muted', null, endNote) : null,
      h('p.muted', null, `${Math.floor(g.time / 60)}:${String(Math.floor(g.time) % 60).padStart(2, '0')} · ${S.bought} blocks bought · ${Math.round(S.spent)}g on units · income level ${S.incomeLvl} · ${TIER_NAMES[S.tier]} hulls`),
      h('div.row', null,
        ai ? h('button.primary', { onclick: () => { sfx('click'); app.go({ name: 'tugmatch', launch: { kind: 'ai', difficulty: L.kind === 'ai' ? L.difficulty : 'normal', roster: rosters[0] } }); } }, 'Play again') : null,
        h('button', { onclick: () => { sfx('click'); app.go({ name: 'tug' }); } }, 'Back'),
      ),
    );
    el.append(h('div.tug-endveil', null, box));
  };

  const quit = async () => {
    sfx('click');
    if (!g.done && !ended) {
      if (!confirm('Surrender and leave the game?')) return;
      if (net) { try { await tugCommand(net.id, { t: 'surrender' }); } catch { /* leaving anyway */ } }
      reportGame();
    }
    app.go({ name: 'tug' });
  };

  renderSpeed();
  renderCards();
  // frame the whole field with our castle at the bottom
  // the whole field, nudged toward our end so our castle clears the bottom edge (the 3D perspective framing cut it off)
  requestAnimationFrame(() => {
    try {
      view.resize();
      view.fit(true);
      view.frameWorldBox(-3, -3, FIELD_W + 3, FIELD_H + 3);
      view.centerOn(FIELD_W / 2, me === 0 ? FIELD_H / 2 + 6 : FIELD_H / 2 - 6);
    } catch { /* */ }
  });

  return {
    el,
    destroy() {
      destroyed = true;
      shop?.close();
      setField(STANDARD_FIELD); // TugGame switched to the tug field; every other screen plays on the standard one
      abort.abort();
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      clearTimeout(hintTimer);
      try { view.destroy(); } catch { /* */ }
    },
  };
};

const TUG_GHOST_MS = 1400;
/** seconds of battle time a wreck stays on the tug field */
const TUG_WRECK_LIFE = 15;
