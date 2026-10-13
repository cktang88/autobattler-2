// vs-AI setup: choose difficulty, review the active deck, start (or resume) a local match.

import { h, type App, type Screen } from '../app.ts';
import { playMusic, sfx } from '../audio.ts';
import { activeDeck } from '../collection.ts';
import { LocalDriver } from '../localdriver.ts';
import { currentSession } from '../net.ts';
import type { AiDifficulty } from '../../shared/ai.ts';
import { paintWhenLaidOut, safeStats, sizeLabel } from './match-ui.ts';

const KEY_DIFF = 'ab2.aiDifficulty';

const DIFFS: { id: AiDifficulty; name: string; desc: string }[] = [
  { id: 'easy', name: 'Easy', desc: 'Scrappy builds, loose placement. Learn the ropes.' },
  { id: 'normal', name: 'Normal', desc: 'Solid designs and sensible formations.' },
  { id: 'hard', name: 'Hard', desc: 'Counters your army and spends every credit.' },
];

export function playerName(): string {
  try { return currentSession()?.name || 'Commander'; } catch { return 'Commander'; }
}

export function vsaiScreen(app: App): Screen {
  playMusic('menu');
  let diff: AiDifficulty = 'normal';
  try {
    const d = localStorage.getItem(KEY_DIFF);
    if (d === 'easy' || d === 'normal' || d === 'hard') diff = d;
  } catch { /* ignore */ }

  const deck = activeDeck();
  const diffBtns = DIFFS.map((d) =>
    h('button.diff-card', {
      onclick: () => {
        sfx('click');
        diff = d.id;
        try { localStorage.setItem(KEY_DIFF, diff); } catch { /* ignore */ }
        diffBtns.forEach((b, i) => b.classList.toggle('active', DIFFS[i].id === diff));
      },
    }, h('b', null, d.name), h('small', null, d.desc)),
  );
  diffBtns.forEach((b, i) => b.classList.toggle('active', DIFFS[i].id === diff));

  const previews: { canvas: HTMLCanvasElement; design: (typeof deck)[number] }[] = [];
  const deckCards = deck.map((d) => {
    const canvas = h('canvas');
    previews.push({ canvas, design: d });
    const st = safeStats(d);
    return h('div.deck-card', null,
      canvas,
      h('div.name', { title: d.name }, d.name),
      h('div.meta', null,
        h('span', { style: { color: 'var(--gold)' } }, st ? `${st.cost}` : '?'),
        h('span', null, st ? sizeLabel(st.size) : ''),
        st?.flying ? h('span', null, 'Air') : null,
      ),
    );
  });

  const resumable = LocalDriver.resumable();
  const start = () => {
    if (!deck.length) { app.toast('Your deck is empty — build some designs in the Garage.', 'error'); return; }
    sfx('click');
    try {
      const d = LocalDriver.create(diff, deck, playerName());
      app.go({ name: 'match', driver: d });
    } catch (e) {
      console.error(e);
      app.toast('Could not start match: ' + (e as Error).message, 'error');
    }
  };

  const el = h('div.screen', null,
    h('div.topbar', null,
      h('button.icon', { onclick: () => { sfx('click'); app.go({ name: 'menu' }); }, title: 'Back' }, '‹ Back'),
      h('h2', null, 'Play vs AI'),
    ),
    h('div.screen-scroll.grow', null,
      h('div.page', null,
        resumable ? h('div.panel', null,
          h('div.row', { style: { flexWrap: 'wrap' } },
            h('div.grow', null,
              h('div.panel-title', null, 'Match in progress'),
              h('div', null, `Round ${resumable.match.round} vs ${resumable.match.players[1].name} · HP ${resumable.match.players[0].hp} – ${resumable.match.players[1].hp}`),
            ),
            h('button.warn', {
              onclick: () => {
                sfx('click');
                const d = LocalDriver.resume();
                if (d) app.go({ name: 'match', driver: d });
              },
            }, 'Resume'),
          ),
        ) : null,
        h('div.panel', null,
          h('div.panel-title', null, 'Difficulty'),
          h('div.diff-grid', null, ...diffBtns),
        ),
        h('div.panel', null,
          h('div.row', { style: { marginBottom: '8px' } },
            h('div.panel-title.grow', { style: { margin: 0 } }, `Your deck · ${deck.length} design${deck.length === 1 ? '' : 's'}`),
            h('button.small', { onclick: () => { sfx('click'); app.go({ name: 'garage' }); } }, 'Edit in Garage'),
          ),
          deck.length
            ? h('div.deck-grid', null, ...deckCards)
            : h('p.muted', null, 'No designs in your deck yet. Head to the Garage to build some.'),
        ),
        h('div.start-row', null,
          resumable ? h('span.muted', { style: { alignSelf: 'center' } }, 'Starting a new match abandons the one in progress.') : null,
          h('button.big.primary', { onclick: start, disabled: !deck.length }, 'Start Match'),
        ),
      ),
    ),
  );

  paintWhenLaidOut(previews);
  const onResize = () => paintWhenLaidOut(previews);
  window.addEventListener('resize', onResize);
  return { el, destroy: () => window.removeEventListener('resize', onResize) };
}
