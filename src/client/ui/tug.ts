// Tug of war screens (shared/tug.ts): the setup page (pick a roster, then play the AI or another person online)
// and the live game (buy blocks from the roster and drop them on your half while the fight runs).
//
// Online games are lockstep: commands go to the server, which stamps each with a tick a little ahead; this screen
// long-polls the order log and simulates the same TugGame as the opponent up to the server's frontier.

import { h, type App, type Screen, type ScreenFn } from '../app.ts';
import { playMusic, sfx } from '../audio.ts';
import { allDesigns, activeDeck } from '../collection.ts';
import {
  NetError, tugCommand, tugCreate, tugJoin, tugLeave, tugList, tugPoll, tugQuick, tugResult, type TugRoom,
} from '../net.ts';
import { makeView } from '../render/viewfactory.ts';
import type { BattleView } from '../render/view.ts';
import { applyViewSettings, loadSettings } from '../storage.ts';
import { openModal, paintWhenLaidOut, sizeLabel } from './match-ui.ts';
import { zoomButtons } from './fieldtools.ts';
import { drawPartIcon } from '../render/field.ts';
import { MODULE_BY_ID } from '../../shared/parts.ts';
import { weaponDps } from '../../shared/stats.ts';
import { aiDeck, type AiDifficulty } from '../../shared/ai.ts';
import { FIELD_H, FIELD_W, STANDARD_FIELD, fmtMeters, setField } from '../../shared/grid.ts';
import { TICK_RATE } from '../../shared/sim/types.ts';
import { computeStats } from '../../shared/stats.ts';
import {
  TIER_COST, TIER_NAMES, TUG, advance, castleGunPrice, castleGuns, blockCenters, dropZone, incomeCost, incomeRate,
  validateRoster, TugGame, type TugCommand, type TugOrder,
} from '../../shared/tug.ts';
import { TugAi } from '../../shared/tugai.ts';
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
  let roster = tugRoster();
  let busy = false;
  let waitingRoom: TugRoom | null = null;
  let abort: AbortController | null = null;
  let destroyed = false;

  const rosterHost = h('div.tug-roster');
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
    );
  };

  const renderRoster = () => {
    rosterHost.replaceChildren(
      ...roster.map((d) => card(d, true)),
      ...Array.from({ length: TUG.rosterSize - roster.length }, () => h('div.tug-card.empty', null, 'empty')),
    );
    const inR = new Set(roster.map((d) => d.id));
    poolHost.replaceChildren(...allDesigns().filter((d) => !inR.has(d.id)).map((d) => card(d, false)));
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
        playPanel,
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
  // the same field controls as a match and the playground: wheel / pinch zoom, drag / WASD pan, right-drag (Ctrl /
  // Option + drag), two-finger twist or Q / E to turn the 3D view, +/- and F, and the zoom buttons
  view.controls.rotate = !!view.canRotate;
  fieldwrap.append(zoomButtons(view));

  // ---- roster cards ----
  let sel = -1, rot = false;
  const cards: { el: HTMLElement; d: Design; cost: HTMLElement; cd: HTMLElement }[] = [];
  /** online: designs bought but not yet in the game, and when (performance.now ms) their cooldown runs out */
  const localReady = new Map<string, number>();
  /** seconds until this design can be bought again */
  const cooldownLeft = (id: string): number => Math.max(g.cooldown(me, id) / TICK_RATE, ((localReady.get(id) ?? 0) - performance.now()) / 1000);
  rosters[me].forEach((d, i) => {
    const cv = h('canvas.tug-thumb');
    const cost = h('span.gold');
    const cd = h('span.tug-cd', { 'aria-hidden': 'true' });
    const st = computeStats(d);
    const c = h('button.tug-unit', {
      title: `${d.name} — ${st.cost}g, ${sizeLabel(st.size)}${st.squad > 1 ? `, squad of ${st.squad}` : ''}  [${i + 1}]`,
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
      else if (c.t === 'tier') s += TIER_COST[Math.min(5, g.sides[me].tier + 1) as Size];
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
      c.cd.style.setProperty('--cd', String(Math.min(1, left / TUG.buyCooldown)));
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
    if (S.tier >= TUG.maxTier) { tierBtn.textContent = 'All hulls unlocked'; tierBtn.disabled = true; }
    else {
      const nt = (S.tier + 1) as Size, c = TIER_COST[nt];
      tierBtn.replaceChildren(h('span', null, `Unlock ${TIER_NAMES[nt]}`), h('small.gold', null, ` ${c}g`));
      tierBtn.disabled = gold < c || g.done;
    }
  };

  // ---- castle gun shop: every weapon a castle can carry, cheapest first ----
  let shop: { close(): void } | null = null;
  function openGunShop(): void {
    if (g.done || shop) return;
    sfx('click');
    const rows: { b: HTMLButtonElement; m: ModuleDef; price: number }[] = [];
    const cur = h('p');
    const r0 = h('p.bad.gunshop-err');
    const list = h('div.gunshop');
    for (const m of castleGuns()) {
      const price = castleGunPrice(m);
      const icon = h('canvas.gunshop-icon', { width: '96', height: '96' }) as HTMLCanvasElement;
      try { drawPartIcon(icon, 'module', m.id, { backdrop: true }); } catch { /* icon is decoration */ }
      const reach = [m.targetsGround ? 'ground' : '', m.targetsAir ? 'air' : ''].filter(Boolean).join(' + ');
      const b = h('button.gunshop-card', {
        onclick: () => {
          const err = checkSpendable({ t: 'castleGun', moduleId: m.id });
          if (err) { sfx('error'); r0.textContent = err; return; }
          send({ t: 'castleGun', moduleId: m.id });
          close();
        },
      }, icon,
        h('span.gunshop-name', null, m.name),
        h('span.gunshop-stats', null, `${Math.round(weaponDps(m))} dps · ${fmtMeters(m.range ?? 0)} · ${reach}`),
        h('span.gunshop-price.gold', null, `${price}g`)) as HTMLButtonElement;
      rows.push({ b, m, price });
      list.append(b);
    }
    const refresh = () => {
      const gold = spendable(), mine = g.sides[me].castleGun;
      cur.replaceChildren('Your castle has a ', h('b', null, MODULE_BY_ID.get(mine)?.name ?? mine), `. Buying a gun replaces it (the old one is not refunded). You have `, h('b.gold', null, `${Math.floor(gold)}g`), '.');
      for (const r of rows) {
        const on = r.m.id === mine;
        r.b.classList.toggle('on', on);
        r.b.classList.toggle('poor', !on && r.price > gold);
        r.b.disabled = on;
        r.b.title = on ? 'Equipped' : r.price > gold ? `Need ${Math.ceil(r.price - gold)}g more` : `Buy for ${r.price}g`;
      }
    };
    refresh();
    const timer = window.setInterval(refresh, 300);
    const handle = openModal('Castle gun', h('div', null, cur, r0, list));
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
    if (!net) { g.apply(me, cmd); renderCards(); return; }
    const cost = cmd.t === 'buy' ? costOf(g.design(me, cmd.designId)!) : cmd.t === 'income' ? incomeCost(g.sides[me].incomeLvl)
      : cmd.t === 'tier' ? TIER_COST[Math.min(5, g.sides[me].tier + 1) as Size] : cmd.t === 'castleGun' ? castleGunPrice(MODULE_BY_ID.get(cmd.moduleId)!) : 0;
    inFlight += cost;
    if (cmd.t === 'buy') {
      ghosts.push({ cmd, at: performance.now() });
      // the cooldown starts now on this screen (the game starts it when the order lands, ~1 s later)
      localReady.set(cmd.designId, performance.now() + (TUG.buyCooldown + TUG_LEAD_S) * 1000);
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
  canvas.addEventListener('pointermove', (e) => { hover = toWorld(e); });
  canvas.addEventListener('pointerleave', () => { hover = null; });
  canvas.addEventListener('pointerup', (e) => {
    if (view.wasDrag || e.button > 0) return;
    const w = toWorld(e);
    if (!w || sel < 0) return;
    send({ t: 'buy', designId: cards[sel].d.id, x: w.x, y: w.y, ...(rot ? { rot: true } : {}) });
  });
  canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); if (sel >= 0 && !view.wasDrag) { sel = -1; renderCards(); } });
  const onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    const n = Number(e.key);
    if (n >= 1 && n <= cards.length) { sel = sel === n - 1 ? -1 : n - 1; renderCards(); }
    else if (e.key === 'Escape') { sel = -1; renderCards(); }
    else if (e.key === 'r' || e.key === 'R') rot = !rot;
    else if (e.key === 'i' || e.key === 'I') send({ t: 'income' });
    else if (e.key === 'u' || e.key === 'U') send({ t: 'tier' });
    else if (e.key === 'g' || e.key === 'G') openGunShop();
    else if (e.key === ' ' && ai) { paused = !paused; renderSpeed(); e.preventDefault(); }
  };
  window.addEventListener('keydown', onKey);
  const onResize = () => { try { view.resize(); } catch { /* */ } };
  window.addEventListener('resize', onResize);

  // ---- overlay: drop zone, the block under the cursor, pending drops ----
  const octx = overlay.getContext('2d')!;
  const quad = (x0: number, y0: number, x1: number, y1: number) => {
    const p = [view.worldToScreen(x0, y0), view.worldToScreen(x1, y0), view.worldToScreen(x1, y1), view.worldToScreen(x0, y1)];
    octx.beginPath();
    octx.moveTo(p[0].x, p[0].y);
    for (let i = 1; i < 4; i++) octx.lineTo(p[i].x, p[i].y);
    octx.closePath();
  };
  const drawBlock = (d: Design, x: number, y: number, r: boolean, ok: boolean, alpha: number) => {
    const st = computeStats(d);
    const fw = st.fw, fh = st.fh;
    octx.fillStyle = ok ? `rgba(80, 220, 140, ${0.35 * alpha})` : `rgba(240, 80, 70, ${0.35 * alpha})`;
    octx.strokeStyle = ok ? `rgba(120, 255, 170, ${alpha})` : `rgba(255, 110, 90, ${alpha})`;
    octx.lineWidth = 1.5;
    for (const c of blockCenters(me, d, x, y, r && st.squad > 1)) {
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
    if (sel >= 0) {
      const z = dropZone(me);
      quad(z.x0 + 0.2, z.y0 + 0.2, z.x1 - 0.2, z.y1 - 0.2);
      octx.fillStyle = 'rgba(63, 182, 232, 0.06)';
      octx.fill();
      octx.setLineDash([6, 6]);
      octx.strokeStyle = 'rgba(63, 182, 232, 0.55)';
      octx.lineWidth = 1.5;
      octx.stroke();
      octx.setLineDash([]);
      if (hover) {
        const d = cards[sel].d;
        const ok = !checkSpendable({ t: 'buy', designId: d.id, x: hover.x, y: hover.y, ...(rot ? { rot: true } : {}) });
        drawBlock(d, hover.x, hover.y, rot, ok, 1);
      }
    }
    const now = performance.now();
    for (let i = ghosts.length - 1; i >= 0; i--) {
      const gh = ghosts[i];
      if (now - gh.at > TUG_GHOST_MS) { ghosts.splice(i, 1); continue; }
      const d = g.design(me, gh.cmd.designId);
      if (d) drawBlock(d, gh.cmd.x, gh.cmd.y, !!gh.cmd.rot, true, 0.5 + 0.3 * Math.sin(now / 90));
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
      hint.textContent = `Click your deploy zone to drop ${cards[sel].d.name}${computeStats(cards[sel].d).squad > 1 ? ' · R rotates' : ''} · right-click / Esc cancels · right-drag turns the view`;
      hint.classList.add('show');
    } else if (sel < 0 && !hintTimer) hint.classList.remove('show');
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
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
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
          while (acc >= 1 && !g.done && n++ < 40) {
            for (const c of ai!.think(g)) g.apply(1, c);
            g.step();
            view.pushEvents(g.battle.events);
            acc -= 1;
          }
        }
      }
      view.drawBattle(g.battle, dt);
      drawOverlay();
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
