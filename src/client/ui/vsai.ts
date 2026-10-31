// vs-AI setup: pick difficulty, build the deck (drag designs between your collection and the 9 deck slots) with a live
// analysis of what the deck can and can't do, then start (or resume) a local match.

import { h, type App, type Screen } from '../app.ts';
import { playMusic, sfx } from '../audio.ts';
import { activeDeck, allDesigns, setDeck } from '../collection.ts';
import { LocalDriver } from '../localdriver.ts';
import { currentSession } from '../net.ts';
import type { AiDifficulty } from '../../shared/ai.ts';
import { DECK_SIZE } from '../../shared/match.ts';
import type { Design } from '../../shared/types.ts';
import { paintPreview, sizeLabel } from './match-ui.ts';
import * as kit from './kit.ts';
import { CAPS, designInfo, type Cap, type DesignInfo } from './deckstats.ts';
import { CAP_ICON, capBadges, renderDeckAnalysis } from './deckpanel.ts';
import { fmtUnitPrice } from '../../shared/stats.ts';

const KEY_DIFF = 'ab2.aiDifficulty';
const KEY_SORT = 'ab2.deckSort';
const DRAG_MIME = 'application/x-design-id';

const DIFFS: { id: AiDifficulty; name: string; desc: string }[] = [
  { id: 'easy', name: 'Easy', desc: 'Scrappy builds, loose placement. Learn the ropes.' },
  { id: 'normal', name: 'Normal', desc: 'A rotating deck of tuned designs that adapts to your army every round.' },
  { id: 'hard', name: 'Hard', desc: 'Simulates its options against your army and picks the best. Learns from your designs.' },
];

type Sort = 'edited' | 'size' | 'cost' | 'costDesc' | 'name' | 'range' | 'speed' | 'dps';
const SORTS: { value: Sort; label: string }[] = [
  { value: 'edited', label: 'Last edited' },
  { value: 'size', label: 'Weight class' },
  { value: 'cost', label: 'Cost: low to high' },
  { value: 'costDesc', label: 'Cost: high to low' },
  { value: 'dps', label: 'Firepower' },
  { value: 'range', label: 'Range' },
  { value: 'speed', label: 'Speed' },
  { value: 'name', label: 'Name' },
];
const sorter: Record<Sort, (a: DesignInfo, b: DesignInfo) => number> = {
  edited: (a, b) => (b.d.editedAt ?? 0) - (a.d.editedAt ?? 0) || a.cost - b.cost,
  size: (a, b) => a.st.size - b.st.size || a.cost - b.cost,
  cost: (a, b) => a.cost - b.cost,
  costDesc: (a, b) => b.cost - a.cost,
  dps: (a, b) => b.gnd + b.air - (a.gnd + a.air),
  range: (a, b) => b.rangeM - a.rangeM,
  speed: (a, b) => b.speedMs - a.speedMs,
  name: (a, b) => a.d.name.localeCompare(b.d.name),
};

export function playerName(): string {
  // the placeholder account made for garage sync ("Pilot 1234") is not a callsign the player chose
  try { const s = currentSession(); return (s && !s.auto && s.name) || 'Commander'; } catch { return 'Commander'; }
}

export function vsaiScreen(app: App, route: { name: 'vsai'; from?: 'lobby' | 'menu' } = { name: 'vsai' }): Screen {
  /** loadout editor only (menu "Loadout" / lobby "Change loadout"): Done goes back, no difficulty / Start */
  const editOnly = route.from != null;
  const backTo = route.from === 'lobby' ? 'lobby' as const : route.from === 'menu' ? 'menu' as const : 'classic' as const;
  playMusic('menu');
  let diff: AiDifficulty = 'normal';
  let sort: Sort = 'cost';
  try {
    const d = localStorage.getItem(KEY_DIFF);
    if (d === 'easy' || d === 'normal' || d === 'hard') diff = d;
    const s = localStorage.getItem(KEY_SORT);
    if (s && SORTS.some((x) => x.value === s)) sort = s as Sort;
  } catch { /* ignore */ }

  const all = allDesigns();
  const infoById = new Map<string, DesignInfo>();
  for (const d of all) { const i = designInfo(d); if (i) infoById.set(d.id, i); }
  let deck = activeDeck().map((d) => d.id).filter((id) => infoById.has(id));
  let capFilter: Cap | '*' = '*';

  const diffHost = h('div.db-diffhost');
  const collHost = h('div.db-coll');
  const deckHost = h('div.db-deck');
  const statsHost = h('div.db-stats');
  const toolsHost = h('div.db-tools');
  const startBtn = h('button.big.primary', { onclick: () => start() }, 'Start Match');
  const previews: { c: HTMLCanvasElement; d: Design }[] = [];

  function save() {
    setDeck(deck);
    deck = activeDeck().map((d) => d.id).filter((id) => infoById.has(id));
  }
  function add(id: string, at?: number) {
    if (deck.includes(id)) {
      // dropped onto a slot: reorder
      if (at !== undefined) { deck = deck.filter((x) => x !== id); deck.splice(Math.min(at, deck.length), 0, id); save(); render(); }
      return;
    }
    if (deck.length >= DECK_SIZE) {
      if (at === undefined || at >= deck.length) { sfx('error'); app.toast(`Deck is full (${DECK_SIZE}). Drop onto a slot to replace it, or remove one first.`, 'error'); return; }
      deck[at] = id; // replace the slot it was dropped on
    } else deck.splice(at === undefined ? deck.length : Math.min(at, deck.length), 0, id);
    sfx('place');
    save();
    render();
  }
  function remove(id: string) {
    if (!deck.includes(id)) return;
    if (deck.length <= 1) { sfx('error'); app.toast('Your deck needs at least one design', 'error'); return; }
    deck = deck.filter((x) => x !== id);
    sfx('click');
    save();
    render();
  }

  // ---------- drag & drop ----------
  const dragSrc = { id: '', fromDeck: false };
  function draggable(node: HTMLElement, id: string, fromDeck: boolean) {
    node.draggable = true;
    node.addEventListener('dragstart', (e) => {
      dragSrc.id = id; dragSrc.fromDeck = fromDeck;
      e.dataTransfer?.setData(DRAG_MIME, id);
      e.dataTransfer?.setData('text/plain', id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      document.body.classList.add('db-dragging', fromDeck ? 'db-from-deck' : 'db-from-coll');
    });
    node.addEventListener('dragend', () => {
      document.body.classList.remove('db-dragging', 'db-from-deck', 'db-from-coll');
      for (const n of document.querySelectorAll('.db-over')) n.classList.remove('db-over');
    });
  }
  function dropZone(node: HTMLElement, onDrop: (id: string) => void) {
    node.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes(DRAG_MIME)) { e.preventDefault(); node.classList.add('db-over'); } });
    node.addEventListener('dragleave', (e) => { if (!node.contains(e.relatedTarget as Node)) node.classList.remove('db-over'); });
    node.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      node.classList.remove('db-over');
      const id = e.dataTransfer?.getData(DRAG_MIME) || dragSrc.id;
      if (id) onDrop(id);
    });
  }

  // ---------- rendering ----------

  /** what a design is at a glance: weight class, what it can shoot at, and how many units one purchase buys */
  const roleChips = (i: DesignInfo) => {
    const st = i.st;
    return h('div.db-chips', null,
      h('span.db-chip.cls', { class: `sz${st.size}`, title: `${sizeLabel(st.size)} class · footprint ${st.fw}×${st.fh} cells` }, sizeLabel(st.size)),
      i.gnd > 0 ? h('span.db-chip.gnd', { title: `Hits ground units · ${Math.round(i.gnd)} dps per block` }, 'GND') : null,
      i.air > 0 ? h('span.db-chip.air', { title: `Hits aircraft · ${Math.round(i.air)} dps per block` }, 'AIR') : null,
      i.gnd <= 0 && i.air <= 0 ? h('span.db-chip.none', { title: 'No weapons' }, 'NO GUNS') : null,
      st.flying ? h('span.db-chip.fly', { title: 'Flies: only anti-air weapons can hit it' }, 'FLYER') : null);
  };

  function card(i: DesignInfo, where: 'coll' | 'deck', slot = -1): HTMLElement {
    const c = h('canvas.db-prev', { 'aria-hidden': 'true' });
    previews.push({ c, d: i.d });
    const inDeck = deck.includes(i.d.id);
    const st = i.st;
    const el = h('div.db-card', {
      class: [where === 'coll' && inDeck ? 'in' : '', st.flying ? 'air' : '', `sz${st.size}`].join(' '),
      role: 'button', tabindex: '0', 'data-fk': `${where}-${i.d.id}`,
      title: where === 'coll' ? (inDeck ? 'In your deck · click or drag back to remove' : 'Click or drag into your deck') : 'Drag out (or click ✕) to remove · drop another design here to replace',
      onclick: () => (where === 'deck' ? undefined : inDeck ? remove(i.d.id) : add(i.d.id)),
      onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (where === 'coll') (inDeck ? remove(i.d.id) : add(i.d.id)); } if ((e.key === 'Delete' || e.key === 'Backspace') && where === 'deck') remove(i.d.id); },
    },
    h('div.db-prevwrap', null, c,
      st.squad > 1 ? h('span.db-squad', { title: `Squad: one purchase deploys ${st.squad} units` }, `×${st.squad}`) : null),
    h('div.db-name', { title: i.d.name }, i.d.name),
    roleChips(i),
    h('div.db-meta', null,
      h('b.db-cost', { title: st.squad > 1 ? `Block price: buys the whole squad of ${st.squad} units (≈${fmtUnitPrice(st.unitCost)} each)` : 'Supply price' }, String(i.cost)),
      st.squad > 1 ? null : h('span', { title: 'Footprint in cells (width × length)' }, `${st.fw}×${st.fh}`),
      h('span', { title: 'Longest reach' }, `${Math.round(i.rangeM)} m`)),
    capBadges(i),
    where === 'coll' && inDeck ? h('span.db-tick', { 'aria-hidden': 'true' }, '✓') : null,
    where === 'deck' ? h('button.db-x', { type: 'button', title: 'Remove from deck', 'aria-label': `Remove ${i.d.name}`, onclick: (e: Event) => { e.stopPropagation(); remove(i.d.id); } }, '✕') : null,
    );
    draggable(el, i.d.id, where === 'deck');
    if (where === 'deck') dropZone(el, (id) => add(id, slot));
    return el;
  }

  function renderDiff() {
    diffHost.replaceChildren(h('span.db-difflbl', { title: DIFFS.find((d) => d.id === diff)!.desc }, 'AI'), kit.segmented({
      value: diff, label: 'Difficulty', className: 'db-diff',
      options: DIFFS.map((d) => ({ value: d.id, label: d.name, title: d.desc })),
      onChange: (v) => { diff = v; try { localStorage.setItem(KEY_DIFF, diff); } catch { /* */ } sfx('click'); renderDiff(); },
    }));
  }

  function renderColl() {
    const infos = [...infoById.values()].filter((i) => capFilter === '*' || i.caps.has(capFilter)).sort(sorter[sort]);
    toolsHost.replaceChildren(
      kit.select({ value: sort, label: 'Sort designs', prefix: 'Sort', options: SORTS, onChange: (v) => { sort = v; try { localStorage.setItem(KEY_SORT, v); } catch { /* */ } render(); } }),
      kit.select({
        value: capFilter, label: 'Filter by capability', prefix: 'Show',
        options: [{ value: '*', label: 'All designs' }, ...CAPS.map((c) => ({ value: c.id, label: c.label, hint: c.tip, icon: CAP_ICON[c.id] }))],
        onChange: (v) => { capFilter = v as Cap | '*'; render(); },
      }),
      h('span.spacer'),
      h('button.small', { onclick: () => { sfx('click'); app.go({ name: 'garage' }); }, title: 'Build and edit unit designs' }, 'Unit Designer'),
    );
    collHost.replaceChildren(...(infos.length ? infos.map((i) => card(i, 'coll')) : [h('p.muted', null, 'No designs match.')]));
  }

  function renderDeck() {
    // the deck reads cheapest first, the same order the match shop uses
    const ordered = deck.map((id) => infoById.get(id)!).filter(Boolean).sort((a, b) => a.cost - b.cost);
    const slots: HTMLElement[] = ordered.map((i, k) => card(i, 'deck', deck.indexOf(i.d.id) >= 0 ? deck.indexOf(i.d.id) : k));
    for (let k = ordered.length; k < DECK_SIZE; k++) {
      const empty = h('div.db-slot', null, h('span', null, 'Empty slot'), h('small', null, 'drag a design here'));
      dropZone(empty, (id) => add(id));
      slots.push(empty);
    }
    deckHost.replaceChildren(
      h('div.db-deck-h', null, h('div.panel-title', null, `Deck · ${deck.length}/${DECK_SIZE}`), h('small.muted', null, 'sorted by cost')),
      h('div.db-slots', null, ...slots));
    startBtn.disabled = !deck.length;
  }

  function renderStats() {
    renderDeckAnalysis(statsHost, deck.map((id) => infoById.get(id)!.d), { slots: DECK_SIZE, mode: 'match' });
  }

  function render() {
    // cards are rebuilt: keyboard focus moves to the same card's replacement
    const ae = document.activeElement as HTMLElement | null;
    const fk = ae && (collHost.contains(ae) || deckHost.contains(ae)) ? ae.getAttribute('data-fk') : null;
    previews.length = 0;
    renderColl();
    renderDeck();
    renderStats();
    if (fk) (collHost.querySelector<HTMLElement>(`[data-fk="${CSS.escape(fk)}"]`) ?? deckHost.querySelector<HTMLElement>(`[data-fk="${CSS.escape(fk)}"]`))?.focus({ preventScroll: true });
    requestAnimationFrame(() => requestAnimationFrame(() => { for (const p of previews) paintPreview(p.c, p.d, 0); }));
  }

  // dropping a deck card anywhere on the collection removes it
  dropZone(collHost, (id) => { if (dragSrc.fromDeck) remove(id); });
  dropZone(deckHost, (id) => add(id));

  const resumable = LocalDriver.resumable();
  function start() {
    const ds = activeDeck();
    if (!ds.length) { app.toast('Your deck is empty — drag some designs into it.', 'error'); return; }
    sfx('click');
    try {
      const d = LocalDriver.create(diff, ds, playerName());
      app.go({ name: 'match', driver: d });
    } catch (e) {
      console.error(e);
      app.toast('Could not start match: ' + (e as Error).message, 'error');
    }
  }

  renderDiff();
  render();

  const el = h('div.screen.dbscreen', null,
    h('div.topbar', null,
      h('button.icon', { onclick: () => { sfx('click'); app.go({ name: backTo }); }, title: 'Back' }, '‹ Back'),
      h('h2', null, route.from === 'lobby' ? 'Multiplayer loadout' : editOnly ? 'Loadout' : 'Play vs AI'),
      h('span.spacer'),
      editOnly ? null : diffHost,
      editOnly ? h('button.big.primary', { onclick: () => { sfx('click'); app.go({ name: backTo }); }, disabled: !deck.length }, 'Done ›') : null,
      !editOnly && resumable ? h('button.warn', {
        onclick: () => { sfx('click'); const d = LocalDriver.resume(); if (d) app.go({ name: 'match', driver: d }); },
        title: `Round ${resumable.match.round} vs ${resumable.match.players[1].name} · HP ${resumable.match.players[0].hp} – ${resumable.match.players[1].hp}`,
      }, `Resume round ${resumable.match.round}`) : null,
      editOnly ? null : startBtn,
    ),
    h('div.db-body', null,
      h('section.panel.db-left', null,
        h('div.panel-title', null, `Your designs · ${infoById.size}`),
        toolsHost,
        collHost),
      h('section.db-right', null,
        h('div.panel', null, deckHost),
        h('div.panel', null, statsHost),
        editOnly ? h('p.muted.db-note', null, 'One loadout for vs-AI and multiplayer: changes save as you go. Each multiplayer match keeps the deck you had when you created or joined it.')
          : resumable ? h('p.muted.db-note', null, 'Starting a new match abandons the one in progress.') : null,
      ),
    ),
  );

  const onResize = () => { for (const p of previews) paintPreview(p.c, p.d, 0); };
  window.addEventListener('resize', onResize);
  return { el, destroy: () => window.removeEventListener('resize', onResize) };
}
