// Multiplayer lobby: callsign login, your async matches, open public matches, create/join/quick match.

import { h, type Screen, type ScreenFn } from '../app.ts';
import { sfx } from '../audio.ts';
import { activeDeck, allDesigns, setDeck } from '../collection.ts';
import {
  createMatch, createPrivateMatch, currentSession, forfeitMatch, getMe, joinMatch, listMatches, login, logout,
  NetError, openMatch, quickMatch, type MatchSummary,
} from '../net.ts';
import { DECK_SIZE, validateDeck } from '../../shared/match.ts';
import { computeStats } from '../../shared/stats.ts';
import type { Design, Side } from '../../shared/types.ts';
import { confirmModal } from './match-ui.ts';
import * as kit from './kit.ts';

const REFRESH_MS = 10_000;

export const lobbyScreen: ScreenFn<{ name: 'lobby' }> = (app) => {
  const body = h('div.page');
  const userBox = h('div.lobby-user');
  const refreshBtn = h('button.icon', { title: 'Refresh', onclick: () => { sfx('click'); void refresh(true); } }, '⟳');
  const el = h('div.screen.lobby', null,
    h('div.topbar', null,
      h('button.icon', { onclick: () => { sfx('click'); app.go({ name: 'menu' }); }, title: 'Back' }, '‹ Back'),
      h('h2', null, 'Multiplayer'),
      h('div.spacer'),
      userBox,
      refreshBtn,
    ),
    h('div.screen-scroll.grow', null, body),
  );

  let destroyed = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let busy = false;
  let lastData: { mine: MatchSummary[]; open: MatchSummary[] } | null = null;
  let loadError: string | null = null;
  /** code of a private match just created, highlighted at the top */
  let freshCode: string | null = null;
  /** roster editor open in the deck panel */
  let editingDeck = false;
  /** half-typed join code and the "Finished" list state survive the periodic re-render */
  let codeDraft = '';
  let codeInput: HTMLInputElement | null = null;
  let doneOpen = false;
  const baseTitle = document.title;

  // ---------------------------------------------------------------- actions

  const fail = (e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    sfx('error');
    app.toast(msg, 'error');
    if (e instanceof NetError && e.status === 401) render();
  };

  /** Run an async action with all lobby buttons disabled. */
  const act = async (fn: () => Promise<void>) => {
    if (busy) return;
    busy = true;
    el.classList.add('lobby-busy');
    try { await fn(); } catch (e) { fail(e); } finally {
      busy = false;
      el.classList.remove('lobby-busy');
    }
  };

  const deckOrNull = (): Design[] | null => {
    const deck = activeDeck();
    const errs = deck.length ? validateDeck(deck) : ['Your deck is empty'];
    if (errs.length) {
      app.toast(`Fix your deck in the Garage first: ${errs[0]}`, 'error');
      return null;
    }
    return deck;
  };

  const enter = async (id: string) => {
    const driver = await openMatch(id);
    if (destroyed) return;
    sfx('click');
    app.go({ name: 'match', driver });
  };

  const doQuick = () => act(async () => {
    const deck = deckOrNull();
    if (!deck) return;
    const r = await quickMatch(deck);
    if (r.joined) { app.toast('Opponent found!', 'good'); await enter(r.id); return; }
    app.toast('No open matches — yours is listed. We\'ll mark it YOUR TURN when someone joins.', 'info');
    await refresh();
  });

  const doCreate = (priv: boolean) => act(async () => {
    const deck = deckOrNull();
    if (!deck) return;
    if (priv) {
      const r = await createPrivateMatch(deck);
      freshCode = r.code;
      app.toast('Private match created — share the code.', 'good');
    } else {
      await createMatch(deck);
      app.toast('Public match created — waiting for a challenger.', 'good');
    }
    sfx('click');
    await refresh();
  });

  const doJoin = (idOrCode: string) => act(async () => {
    const code = idOrCode.trim();
    if (!code) { app.toast('Enter a join code', 'error'); return; }
    const deck = deckOrNull();
    if (!deck) return;
    const id = await joinMatch(code, deck);
    await enter(id);
  });

  const doForfeit = (s: MatchSummary) => act(async () => {
    const waiting = s.status === 'waiting';
    const ok = await confirmModal(
      waiting ? 'Cancel match?' : 'Forfeit match?',
      waiting ? 'Remove this match from the lobby?' : `Concede the match against ${oppName(s)}? This counts as a loss.`,
      waiting ? 'Cancel match' : 'Forfeit', true);
    if (!ok) return;
    await forfeitMatch(s.id);
    if (s.code && s.code === freshCode) freshCode = null;
    await refresh();
  });

  const doLogin = (name: string) => act(async () => {
    await login(name);
    sfx('ready');
    app.toast(`Welcome, ${currentSession()!.name}.`, 'good');
    render();
    await refresh();
  });

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      app.toast('Copied to clipboard', 'good');
    } catch {
      app.toast(`Code: ${text}`, 'info');
    }
  };

  // ---------------------------------------------------------------- data

  async function refresh(manual = false): Promise<void> {
    if (!currentSession() || destroyed) return;
    refreshBtn.classList.add('lobby-spin');
    try {
      lastData = await listMatches();
      loadError = null;
      if (manual) sfx('click');
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e);
      if (e instanceof NetError && e.status === 401) lastData = null;
    } finally {
      refreshBtn.classList.remove('lobby-spin');
    }
    if (!destroyed) render();
  }

  // ---------------------------------------------------------------- render

  function render(): void {
    const s = currentSession();
    userBox.replaceChildren();
    refreshBtn.classList.toggle('hidden', !s);
    if (!s) {
      document.title = baseTitle;
      body.replaceChildren(loginPanel());
      return;
    }
    userBox.append(
      h('span.lobby-callsign', { title: `Player id ${s.playerId}` }, s.name),
      h('button.lobby-link', {
        onclick: () => { logout(); lastData = null; render(); },
        title: 'Forget this callsign on this device',
      }, 'Sign out'),
    );
    const yourTurn = lastData?.mine.filter((m) => m.yourTurn).length ?? 0;
    document.title = yourTurn ? `(${yourTurn}) ${baseTitle}` : baseTitle;
    const prevInput = codeInput;
    const hadFocus = !!prevInput && document.activeElement === prevInput;
    const caret = hadFocus ? [prevInput!.selectionStart, prevInput!.selectionEnd] as const : null;
    body.replaceChildren(
      deckPanel(),
      actionsPanel(),
      minePanel(),
      openPanel(),
    );
    if (hadFocus && codeInput) {
      const ci: HTMLInputElement = codeInput;
      ci.focus({ preventScroll: true });
      if (caret) try { ci.setSelectionRange(caret[0], caret[1]); } catch { /* */ }
    }
  }

  function loginPanel(): HTMLElement {
    const { el: field, input } = kit.textField({ maxlength: 16, placeholder: 'Callsign', label: 'Callsign', className: 'lobby-input', attrs: { minlength: '2', autocomplete: 'nickname' } });
    const submit = (e?: Event) => { e?.preventDefault(); void doLogin(input.value); };
    const form = h('form.panel.lobby-login', { onsubmit: submit },
      h('div.panel-title', null, 'Enlist'),
      h('h3', null, 'Choose a callsign'),
      h('p.muted', null,
        'Async matches are played over hours or days: submit your deployment whenever you like, and the battle resolves once your opponent has submitted theirs.'),
      h('div.lobby-row', null,
        field,
        h('button.primary', { type: 'submit' }, 'Enlist'),
      ),
      h('p.muted.lobby-small', null, '2–16 characters. Your callsign is remembered on this device.'),
    );
    setTimeout(() => input.focus(), 0);
    return form;
  }

  /** Add/remove a design from the active deck right here in the lobby (no trip to the Garage). */
  const toggleDeck = (id: string) => {
    const ids = activeDeck().map((d) => d.id);
    if (ids.includes(id)) {
      if (ids.length <= 1) { sfx('error'); app.toast('Your deck needs at least one design', 'error'); return; }
      setDeck(ids.filter((x) => x !== id));
    } else {
      if (ids.length >= DECK_SIZE) { sfx('error'); app.toast(`Deck is full (${DECK_SIZE} max) — remove one first`, 'error'); return; }
      setDeck([...ids, id]);
    }
    sfx('click');
    render();
  };

  function deckPanel(): HTMLElement {
    const deck = activeDeck();
    const errs = deck.length ? validateDeck(deck) : ['Your deck is empty'];
    const inDeck = new Set(deck.map((d) => d.id));
    const chip = (d: Design) => {
      let cost = '';
      try { cost = String(computeStats(d).cost); } catch { /* invalid design */ }
      const on = inDeck.has(d.id);
      return editingDeck
        ? h(on ? 'button.lobby-chip.is-on' : 'button.lobby-chip', {
          title: `${d.chassis} / ${d.mobility} — click to ${on ? 'remove from' : 'add to'} deck`,
          onclick: () => toggleDeck(d.id),
        }, on ? '✓ ' : '+ ', d.name, cost ? h('small', null, cost) : null)
        : h('span.lobby-chip', { title: `${d.chassis} / ${d.mobility}` }, d.name, cost ? h('small', null, cost) : null);
    };
    return h('div.panel.lobby-deck', null,
      h('div.lobby-head', null,
        h('div.panel-title', null, `Deck · ${deck.length}/${DECK_SIZE} designs`),
        h('div.spacer'),
        h('button.lobby-link', { onclick: () => { sfx('click'); editingDeck = !editingDeck; render(); } }, editingDeck ? 'Done' : 'Change roster'),
        h('button.lobby-link', { onclick: () => { sfx('click'); app.go({ name: 'garage' }); } }, 'Edit in Garage ›'),
      ),
      h('div.lobby-chips', null, ...(editingDeck ? allDesigns() : deck).map(chip)),
      errs.length ? h('p.lobby-warn', null, `⚠ ${errs[0]}`) : null,
      h('p.muted.lobby-small', null, 'Each match uses the deck you had when you created or joined it — change it here before starting the next one.'),
    );
  }

  function actionsPanel(): HTMLElement {
    const { el: codeField, input: code } = kit.textField({ value: codeDraft, maxlength: 16, placeholder: 'Join code', label: 'Join code', className: 'lobby-input lobby-code-input', attrs: { autocapitalize: 'characters' }, onInput: (v) => { codeDraft = v; } });
    codeInput = code;
    const fresh = freshCode
      ? h('div.lobby-fresh', null,
        h('span.muted', null, 'Share this code:'),
        h('span.lobby-code', null, freshCode),
        h('button', { onclick: () => copy(freshCode!) }, 'Copy'),
        h('button.icon', { title: 'Dismiss', onclick: () => { freshCode = null; render(); } }, '✕'),
      )
      : null;
    return h('div.panel.lobby-actions', null,
      h('div.panel-title', null, 'Find a battle'),
      fresh,
      h('div.lobby-buttons', null,
        h('button.primary.lobby-quick', { onclick: doQuick }, 'Quick Match'),
        h('button', { onclick: () => doCreate(false) }, 'Create Public'),
        h('button', { onclick: () => doCreate(true) }, 'Create Private'),
      ),
      h('form.lobby-row', { onsubmit: (e: Event) => { e.preventDefault(); void doJoin(code.value); } },
        codeField,
        h('button', { type: 'submit' }, 'Join by Code'),
      ),
    );
  }

  function minePanel(): HTMLElement {
    const list = lastData?.mine ?? [];
    const active = list.filter((m) => m.status !== 'done');
    const done = list.filter((m) => m.status === 'done');
    return h('div.panel.lobby-mine', null,
      h('div.lobby-head', null,
        h('div.panel-title', null, `Your matches${active.length ? ` · ${active.length} active` : ''}`),
      ),
      loadError ? h('p.lobby-warn', null, `⚠ ${loadError}`) : null,
      !lastData && !loadError ? h('p.muted', null, 'Loading…') : null,
      lastData && !list.length ? h('p.muted', null, 'No matches yet. Start one with Quick Match.') : null,
      active.length ? h('div.lobby-list', null, ...active.map(mineRow)) : null,
      done.length ? h('details.lobby-done', { open: doneOpen, ontoggle: (e: Event) => { doneOpen = (e.currentTarget as HTMLDetailsElement).open; } },
        h('summary', null, `Finished (${done.length})`),
        h('div.lobby-list', null, ...done.map(mineRow)),
      ) : null,
    );
  }

  function mineRow(s: MatchSummary): HTMLElement {
    const me = (s.side ?? 0) as Side;
    const op = (1 - me) as Side;
    let badge: HTMLElement;
    if (s.status === 'waiting') badge = h('span.lobby-badge.wait', null, 'Waiting for opponent');
    else if (s.status === 'done') {
      const res = s.winner === -1 ? 'Draw' : s.winner === me ? 'Victory' : 'Defeat';
      const why = s.forfeitBy != null ? (s.forfeitBy === me ? ' (forfeit)' : ' (opp. forfeit)') : '';
      badge = h(`span.lobby-badge.${res.toLowerCase()}`, null, res + why);
    } else if (s.yourTurn) badge = h('span.lobby-badge.turn', null, s.opponentReady ? 'Your turn · opp. ready' : 'Your turn');
    else badge = h('span.lobby-badge.wait', null, 'Opponent deploying');

    const info = h('div.lobby-info', null,
      h('div.lobby-name', null, s.status === 'waiting' ? (s.private ? 'Private match' : 'Public match') : `vs ${oppName(s)}`),
      h('div.lobby-meta', null,
        s.status === 'waiting'
          ? `Created ${ago(s.createdAt ?? s.updatedAt)}`
          : `Round ${s.round} · ${ago(s.updatedAt)}`),
    );
    const hp = s.status === 'waiting' ? null : h('div.lobby-hp', { title: 'Your HP vs opponent HP' },
      h('span.friendly', null, String(s.hp[me])), h('span.muted', null, ' : '), h('span.enemy', null, String(s.hp[op])));

    const buttons: HTMLElement[] = [];
    if (s.status === 'waiting') {
      if (s.code) {
        buttons.push(h('span.lobby-code', { title: 'Join code' }, s.code));
        buttons.push(h('button', { onclick: (e: Event) => { e.stopPropagation(); void copy(s.code!); } }, 'Copy'));
      }
      buttons.push(h('button', { onclick: (e: Event) => { e.stopPropagation(); void doForfeit(s); } }, 'Cancel'));
    } else {
      buttons.push(h(s.yourTurn ? 'button.primary' : 'button', {
        onclick: (e: Event) => { e.stopPropagation(); void act(() => enter(s.id)); },
      }, s.status === 'done' ? 'Review' : s.yourTurn ? 'Deploy' : 'View'));
      if (s.status === 'deploy') {
        buttons.push(h('button.icon.lobby-forfeit', {
          title: 'Forfeit', onclick: (e: Event) => { e.stopPropagation(); void doForfeit(s); },
        }, '⚑'));
      }
    }
    const cls = s.yourTurn ? 'div.lobby-match.is-turn' : s.status === 'done' ? 'div.lobby-match.is-done' : 'div.lobby-match';
    return h(cls as 'div', { 'data-id': s.id },
      h('div.lobby-left', null, info, badge),
      hp,
      h('div.lobby-btns', null, ...buttons),
    );
  }

  function openPanel(): HTMLElement {
    const list = lastData?.open ?? [];
    return h('div.panel.lobby-open', null,
      h('div.panel-title', null, `Open matches${list.length ? ` · ${list.length}` : ''}`),
      lastData && !list.length ? h('p.muted', null, 'Nobody is waiting right now. Create a public match and check back later.') : null,
      list.length ? h('div.lobby-list', null, ...list.map((s) =>
        h('div.lobby-match', { 'data-id': s.id },
          h('div.lobby-left', null,
            h('div.lobby-info', null,
              h('div.lobby-name', null, s.names[0]),
              h('div.lobby-meta', null, `Waiting ${ago(s.createdAt ?? s.updatedAt)}`),
            ),
          ),
          h('div.lobby-btns', null, h('button.primary', { onclick: () => doJoin(s.id) }, 'Join')),
        ))) : null,
    );
  }

  // ---------------------------------------------------------------- lifecycle

  const onVisibility = () => { if (document.visibilityState === 'visible') void refresh(); };
  document.addEventListener('visibilitychange', onVisibility);
  // another window of this browser edited the deck (designs/deck live in shared localStorage)
  const onStorage = (e: StorageEvent) => {
    if (busy || (e.key !== 'ab2.deck' && e.key !== 'ab2.designs')) return;
    if (document.activeElement instanceof HTMLInputElement) return; // don't wipe a half-typed join code
    render();
  };
  window.addEventListener('storage', onStorage);
  timer = setInterval(() => {
    if (document.visibilityState === 'visible' && !busy) void refresh();
  }, REFRESH_MS);

  render();
  if (currentSession()) {
    void refresh();
    // verify the stored token is still known to the server (e.g. after a data reset)
    getMe().catch((e) => { if (e instanceof NetError && e.status === 401) { app.toast('Session expired — enlist again.', 'error'); render(); } });
  }

  const screen: Screen = {
    el,
    destroy() {
      destroyed = true;
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('storage', onStorage);
      document.title = baseTitle;
    },
  };
  return screen;
};

function oppName(s: MatchSummary): string {
  const me = s.side ?? 0;
  return s.names[me === 0 ? 1 : 0] ?? '???';
}

function ago(t: number): string {
  const d = Math.max(0, Date.now() - t) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}
