// In-match chat for online PvP: a translucent overlay at the bottom left of the field. Lines fade out after a few
// seconds; Enter (or the chat button, for touch) opens an input with quick-chat buttons and a mute toggle.
// Delivery: its own since-id long poll (net.ts pollChat → server/chat.ts), separate from the match poll.
// All message text goes in through textContent, never innerHTML. Not shown vs the AI or in the playground: only a
// NetDriver (a real opponent) gets a chat.

import { h } from '../app.ts';
import type { MatchDriver } from '../driver.ts';
import { NetDriver, NetError, pollChat, postChat, type ChatMessage } from '../net.ts';
import { sfx } from '../audio.ts';
import type { MatchState, Side } from '../../shared/types.ts';

/** a line stays fully visible this long, then fades out over FADE_MS */
export const CHAT_SHOW_MS = 8000;
const FADE_MS = 1500;
/** the server's limit (server/chat.ts CHAT_MAX_LEN) */
const MAX_LEN = 140;
/** lines kept in the overlay (scrollable while the input is open) */
const MAX_LINES = 30;
const POLL_WAIT_MS = 20000;
const QUICK = ['Hurry up!', 'GG', 'Nice!', 'Oops'];
const MUTE_KEY = 'ab2.chatMuted';

export interface ChatHandle { el: HTMLElement; destroy(): void }

function loadMuted(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(MUTE_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch { return []; }
}
function saveMuted(matchId: string, on: boolean): void {
  try {
    const list = loadMuted().filter((x) => x !== matchId);
    if (on) list.push(matchId);
    localStorage.setItem(MUTE_KEY, JSON.stringify(list.slice(-50)));
  } catch { /* storage unavailable: mute lasts for this screen only */ }
}

const typingTarget = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.tagName === 'BUTTON' || !!el.isContentEditable || el.getAttribute?.('role') === 'combobox');
};

/** Mount the chat on `host` (the field wrapper), kept above the `avoid` bars (the range bar, the speed bar on a
 *  narrow screen) while they show under it. Returns null for anything but an online PvP match. */
export function mountChat(driver: MatchDriver, host: HTMLElement, avoid: HTMLElement[] = []): ChatHandle | null {
  if (!(driver instanceof NetDriver) || driver.mode !== 'pvp') return null;
  const matchId = driver.id;
  const side: Side = driver.side;
  const opp = (1 - side) as Side;
  const oppName = () => driver.state().players[opp]?.name || 'Opponent';
  injectStyle();

  let destroyed = false;
  let open = false;
  let muted = loadMuted().includes(matchId);
  const seen = new Set<number>();
  const timers = new Set<number>();
  const later = (fn: () => void, ms: number) => {
    const t = window.setTimeout(() => { timers.delete(t); if (!destroyed) fn(); }, ms);
    timers.add(t);
  };

  const log = h('div.chat-log', { 'aria-live': 'polite', role: 'log' });
  const input = h('input.chat-input', { type: 'text', maxlength: String(MAX_LEN), placeholder: 'Say something…', title: 'Enter sends, Esc closes', 'aria-label': 'Chat message', autocomplete: 'off', enterkeyhint: 'send' });
  const sendBtn = h('button.small.primary', { type: 'button', onclick: () => void send(input.value) }, 'Send');
  const muteBtn = h('button.small.chat-mute', { type: 'button', onclick: () => setMuted(!muted) });
  const closeBtn = h('button.small', { type: 'button', title: 'Close chat (Esc)', 'aria-label': 'Close chat', onclick: () => setOpen(false) }, '✕');
  const quick = QUICK.map((q) => h('button.small.chat-quick', { type: 'button', onclick: () => void send(q) }, q));
  const panel = h('div.chat-panel', null,
    h('div.chat-row', null, input, sendBtn, closeBtn),
    h('div.chat-row', null, ...quick, muteBtn));
  const toggle = h('button.small.chat-toggle', { type: 'button', title: 'Chat with your opponent (Enter)', 'aria-label': 'Chat', onclick: () => setOpen(!open) }, '💬');
  const el = h('div.chat', null, log, panel, toggle);
  host.append(el);

  function paintMute() {
    muteBtn.textContent = muted ? '🔇 Unmute' : '🔈 Mute';
    muteBtn.title = muted ? `Show ${oppName()}'s messages again` : `Hide ${oppName()}'s messages`;
    muteBtn.setAttribute('aria-pressed', String(muted));
    toggle.classList.toggle('muted', muted);
  }
  function setMuted(on: boolean) {
    muted = on;
    saveMuted(matchId, on);
    paintMute();
    system(on ? `${oppName()} muted` : `${oppName()} unmuted`);
  }
  paintMute();

  function setOpen(on: boolean) {
    if (on && el.classList.contains('hidden')) return;
    open = on;
    el.classList.toggle('open', on);
    if (on) { input.focus(); log.scrollTop = log.scrollHeight; } else { input.blur(); }
  }

  function line(who: string | null, text: string, mine: boolean, fresh: boolean) {
    const row = document.createElement('div');
    row.className = 'chat-line' + (who == null ? ' sys' : mine ? ' me' : ' foe');
    if (who != null) {
      const b = document.createElement('b');
      b.textContent = `${who}: `;
      row.append(b);
    }
    const span = document.createElement('span');
    span.textContent = text;
    row.append(span);
    if (fresh) {
      later(() => row.classList.add('fading'), CHAT_SHOW_MS);
      later(() => row.classList.add('gone'), CHAT_SHOW_MS + FADE_MS);
    } else row.classList.add('gone');
    log.append(row);
    while (log.childElementCount > MAX_LINES) log.firstElementChild!.remove();
    log.scrollTop = log.scrollHeight;
  }
  const system = (text: string) => line(null, text, false, true);

  function add(msgs: ChatMessage[], initial = false) {
    const now = Date.now();
    for (const m of msgs) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      const mine = m.side === side;
      if (!mine && muted) continue;
      // history from before this screen opened stays in the scrollback only (no flash of old lines)
      line(mine ? 'You' : oppName(), m.text, mine, !initial || now - m.at < CHAT_SHOW_MS);
    }
  }

  async function send(raw: string) {
    const text = raw.replace(/\s+/g, ' ').trim();
    // close right away (the line shows once the server took it): Enter, Enter again opens a fresh input
    if (raw === input.value) input.value = '';
    setOpen(false);
    if (!text) return;
    try {
      const msg = await postChat(matchId, text);
      if (destroyed) return;
      sfx('click');
      add([msg]);
    } catch (e) {
      if (destroyed) return;
      sfx('error');
      system((e as Error).message || 'Message not sent');
      if (!input.value) input.value = text; // keep a typed line to retry
    }
  }

  // keys inside the input never reach the game's hotkeys (match.ts / camera also ignore INPUT targets)
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); void send(input.value); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
  });
  input.addEventListener('keyup', (e) => e.stopPropagation());
  // Enter anywhere else opens the input (capture: before the match screen's Enter = deploy / skip)
  const onKey = (e: KeyboardEvent) => {
    if (open || e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    if (typingTarget(e.target) || document.querySelector('.modal-back, .k-pop')) return;
    if (el.classList.contains('hidden')) return;
    e.preventDefault();
    e.stopPropagation();
    setOpen(true);
  };
  window.addEventListener('keydown', onKey, true);

  // only once there is an opponent; above the game-over backdrop when the match is over (time for a "GG")
  function onState(m: MatchState) {
    const waiting = m.status === 'waiting';
    el.classList.toggle('hidden', waiting);
    if (waiting && open) setOpen(false);
    el.classList.toggle('over', m.status === 'done');
  }
  const unsub = driver.subscribe(onState);
  onState(driver.state());

  // keep clear of the bars at the bottom (range bar in deploy; the speed bar spans a phone's width in battle)
  const place = () => {
    const w = host.getBoundingClientRect();
    const right = w.left + 10 + Math.max(el.offsetWidth, 120);
    let lift = 0;
    for (const a of avoid) {
      const r = a.getBoundingClientRect();
      if (r.height > 0 && r.left < right) lift = Math.max(lift, Math.round(w.bottom - r.top + 6));
    }
    el.style.bottom = lift ? `${lift}px` : '';
  };
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null;
  for (const a of avoid) ro?.observe(a);
  ro?.observe(host);
  place();

  // ---- delivery: since-id long poll ----
  let since: number | null = null;
  let failures = 0;
  let abort: AbortController | null = null;
  async function poll() {
    if (destroyed) return;
    const t0 = Date.now();
    let delay = 0;
    try {
      abort = new AbortController();
      const r = await pollChat(matchId, since, POLL_WAIT_MS, abort.signal);
      if (destroyed) return;
      failures = 0;
      add(r.msgs, since == null);
      since = Math.max(since ?? 0, r.last, ...r.msgs.map((m) => m.id));
      // an answer that came straight back (an older server, a finished match): don't spin
      if (!r.msgs.length && Date.now() - t0 < POLL_WAIT_MS / 4) delay = 1500;
    } catch (e) {
      if (destroyed) return;
      // logged out / match gone: no more chat
      if (e instanceof NetError && (e.status === 401 || e.status === 403 || e.status === 404)) return;
      failures++;
      delay = Math.min(60000, 3000 * 2 ** Math.min(failures - 1, 5));
    } finally { abort = null; }
    if (delay) later(() => void poll(), delay);
    else void poll();
  }
  void poll();

  return {
    el,
    destroy() {
      destroyed = true;
      abort?.abort();
      for (const t of timers) clearTimeout(t);
      timers.clear();
      window.removeEventListener('keydown', onKey, true);
      ro?.disconnect();
      unsub();
      el.remove();
    },
  };
}

let styled = false;
function injectStyle(): void {
  if (styled || document.getElementById('chat-style')) { styled = true; return; }
  styled = true;
  const s = document.createElement('style');
  s.id = 'chat-style';
  s.textContent = `
.chat { position: absolute; left: 10px; bottom: calc(30px + var(--safe-b, 0px)); z-index: 5; width: min(340px, calc(100% - 70px));
  display: flex; flex-direction: column; align-items: flex-start; gap: 6px; pointer-events: none; font-size: 0.95rem; }
.chat.hidden { display: none; }
.chat.over { z-index: 36; }
.chat-log { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; max-width: 100%; max-height: 9.5em; overflow: hidden; }
.chat-line { background: rgba(8, 12, 17, 0.55); border-radius: 4px; padding: 2px 8px; line-height: 1.35; max-width: 100%;
  overflow-wrap: anywhere; text-shadow: 0 1px 2px #000; color: var(--text, #dfe7ee); opacity: 1; transition: opacity ${FADE_MS}ms ease; }
.chat-line b { font-weight: 600; }
.chat-line.me b { color: var(--friendly, #3fb6e8); }
.chat-line.foe b { color: var(--enemy, #ff6a3d); }
.chat-line.sys { color: var(--muted, #8193a5); font-style: italic; }
.chat-line.fading { opacity: 0; }
.chat-line.gone { display: none; }
.chat.open .chat-log { max-height: 11em; overflow-y: auto; pointer-events: auto; background: rgba(8, 12, 17, 0.45); border-radius: 6px; padding: 4px; }
.chat.open .chat-line.gone, .chat.open .chat-line.fading { display: block; opacity: 0.85; transition: none; }
.chat-panel { display: none; flex-direction: column; gap: 6px; width: 100%; pointer-events: auto; padding: 6px;
  background: rgba(13, 18, 24, 0.88); border: 1px solid var(--line, #2c3a4a); border-radius: 6px; }
.chat.open .chat-panel { display: flex; }
.chat-row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.chat-input { flex: 1; min-width: 0; font-size: 16px; }
.chat-toggle { pointer-events: auto; width: 36px; height: 36px; padding: 0; font-size: 1.05rem; line-height: 1; background: rgba(20, 27, 36, 0.85); }
.chat-toggle.muted { opacity: 0.6; }
.chat.open .chat-toggle { display: none; }
@media (max-width: 700px) { .chat { width: calc(100% - 20px); } .chat-toggle { width: 40px; height: 40px; } }
`;
  document.head.append(s);
}
