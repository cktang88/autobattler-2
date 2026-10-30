// Main menu: title, animated background (looping AI-vs-AI skirmish, or idling units), navigation.

import { loadSettings } from '../storage.ts';
import { h, type App, type Screen } from '../app.ts';
import { playMusic, sfx } from '../audio.ts';
import type { BoardUnit } from '../render/field.ts';
import type { BattleView } from '../render/view.ts';
import { makeView } from '../render/viewfactory.ts';
import { MAPS } from '../render/ground.ts';
import { LocalDriver } from '../localdriver.ts';
import { Battle } from '../../shared/sim/battle.ts';
import { TICK_RATE, type BattleInput } from '../../shared/sim/types.ts';
import { DEPLOY_D, DEPLOY_W, MAX_SPACING, blockDims, blocksOverlap, hasSpacing, placementUnitCenters, type BlockShape } from '../../shared/grid.ts';
import { computeStats } from '../../shared/stats.ts';
import { STARTER_DESIGNS } from '../../shared/starters.ts';
import { makeRng } from '../../shared/rng.ts';
import type { Design, Placement, Side, Size } from '../../shared/types.ts';
import { openModal } from './match-ui.ts';
import { accountChip } from './account.ts';
import { onSessionChange } from '../net.ts';

/** Random but legal-looking boards built from starter designs. */
function demoInput(seed: number): BattleInput | null {
  const designs = STARTER_DESIGNS.filter((d) => { try { computeStats(d); return true; } catch { return false; } });
  if (!designs.length) return null;
  const rng = makeRng(seed);
  const mk = (): Placement[] => {
    const out: Placement[] = [];
    let budget = 3500;
    for (let tries = 0; tries < 80 && budget > 0; tries++) {
      const d = designs[Math.floor(rng() * designs.length)];
      const st = computeStats(d);
      if (st.cost > budget) continue;
      const spacing = hasSpacing(st) ? Math.floor(rng() * (MAX_SPACING + 1)) : 0;
      const dim = blockDims(st, spacing);
      const x = Math.floor(rng() * (DEPLOY_W - dim.w + 1));
      const y = Math.floor(rng() * (DEPLOY_D - dim.h + 1));
      if (out.some((p) => blocksOverlap({ x, y, spacing }, st, p, shapeOf(designs, p.designId)))) continue;
      out.push({ uid: out.length + 1, designId: d.id, x, y, level: 1 + Math.floor(rng() * 2), round: 1, ...(spacing ? { spacing } : {}) });
      budget -= st.cost;
    }
    return out;
  };
  return { seed, sides: [{ designs, units: mk() }, { designs, units: mk() }] };
}

function shapeOf(designs: Design[], id: string): BlockShape {
  const d = designs.find((x) => x.id === id);
  return d ? computeStats(d) : { size: 1, squad: 1 };
}
function boardUnits(input: BattleInput): BoardUnit[] {
  const out: BoardUnit[] = [];
  input.sides.forEach((s, side) => {
    for (const p of s.units) {
      const d = s.designs.find((x) => x.id === p.designId);
      if (!d) continue;
      for (const c of placementUnitCenters(side as Side, p, computeStats(d))) out.push({ side: side as Side, design: d, x: c.x, y: c.y, level: p.level });
    }
  });
  return out;
}

export function howToPlay(): HTMLElement {
  return h('div.howto', null,
    h('ol', null,
      h('li', null, h('b', null, 'Design'), ' units in the ', h('b', null, 'Unit Designer'), ': pick a chassis, a mobility system and weapon modules. Pick up to 9 designs as your deck in ', h('b', null, 'Loadout'), '.'),
      h('li', null, h('b', null, 'Deploy'), ': each round you get supply. Buy units from your deck (a light design comes as a squad of 4, 8 or 16 per purchase: the cheaper the unit, the bigger the squad) and place them on your half of the field — or upgrade units you already own.'),
      h('li', null, h('b', null, 'Fight'), ': the battle plays out automatically. Units you placed persist and redeploy every round.'),
      h('li', null, 'The round loser takes damage based on the enemy units still standing. Reduce your opponent to 0 HP to win.'),
    ),
    h('p.muted', { style: { marginTop: '10px' } }, 'Tip: mix ranges and counters — anti-air for flyers, armor pierce for heavies, splash for swarms.'),
  );
}

export function menuScreen(app: App): Screen {
  playMusic('menu');
  const canvas = h('canvas.menu-bg');
  let view: BattleView | null = null;
  try { view = makeView(canvas, 0, { interactive: false }); } catch (e) { console.warn(e); }

  // keep the background skirmish silent
  if (view) { view.muted = true; try { view.setTilt(loadSettings().tilt !== false); } catch { /* */ } }
  // a different battlefield each visit
  view?.setMap(MAPS[Math.floor(Math.random() * MAPS.length)]);
  const go = (fn: () => void) => () => {
    sfx('click');
    fn();
  };
  const resumable = LocalDriver.resumable();
  const resumeBtn = resumable
    ? h('button.big.resume', {
        onclick: go(() => {
          const d = LocalDriver.resume();
          if (d) app.go({ name: 'match', driver: d });
        }),
      }, `Resume vs AI · Round ${resumable.match.round}`)
    : null;

  const acctHost = h('div.menu-acct');
  const renderAcct = () => acctHost.replaceChildren(accountChip(app, renderAcct));
  renderAcct();
  const offSession = onSessionChange(renderAcct);

  const el = h('div.screen.menu', null,
    canvas,
    h('div.menu-veil'),
    acctHost,
    h('div.menu-content', null,
      h('div.logo', null,
        h('img', { src: 'icon.svg', alt: '' }),
        h('h1', null, 'Ironclad', h('br'), 'Assembly'),
        h('div.sub', null, 'Design · Deploy · Destroy'),
      ),
      h('div.menu-buttons', null,
        resumeBtn,
        h('button.big.primary', { onclick: go(() => app.go({ name: 'vsai' })) }, 'Play vs AI'),
        h('button.big', { onclick: go(() => app.go({ name: 'lobby' })), title: 'Async matches against other players (needs an account)' }, 'Multiplayer'),
        h('button.big', { onclick: go(() => app.go({ name: 'tug' })), title: 'Real-time tug of war vs the AI or another player: buy units with gold as it flows in and push down the enemy castle' }, 'Tug of War'),
        h('div.row.menu-pair', null,
          h('button.big.grow', { onclick: go(() => app.go({ name: 'vsai', from: 'menu' })), title: 'Choose the 9 designs you take into battle' }, 'Loadout'),
          h('button.big.grow', { onclick: go(() => app.go({ name: 'garage' })), title: 'Build and edit unit designs' }, 'Unit Designer'),
        ),
        h('button.big', { title: 'Sandbox: place any of your designs on both sides for free and watch them fight', onclick: go(() => app.go({ name: 'playground' })) }, 'Playground'),
        h('div.row', null,
          h('button.grow', { onclick: go(() => app.go({ name: 'settings' })) }, 'Settings'),
          h('button.grow', { onclick: go(() => openModal('How to play', howToPlay())) }, 'How to play'),
        ),
      ),
      h('div.menu-foot', null, 'Build your army from parts. Outthink, outgun, outlast.'),
    ),
  );

  // ---- background animation ----
  let raf = 0;
  let last = performance.now();
  let battle: Battle | null = null;
  let idle: BoardUnit[] = [];
  let acc = 0;
  let endTimer = 0;
  let seed = (Date.now() & 0xffff) + 1;
  let battleWorks = true;

  const newScene = () => {
    seed++;
    const input = demoInput(seed);
    idle = input ? boardUnits(input) : [];
    battle = null;
    if (!input || !battleWorks) return;
    try {
      battle = new Battle(input);
      battle.step();
      if (battle.done) { battleWorks = false; battle = null; } // sim not available yet → idle board only
    } catch (e) {
      battleWorks = false;
      battle = null;
    }
    endTimer = 0;
    acc = 0;
  };

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!view) return;
    try {
      if (battle) {
        acc += dt * TICK_RATE * 0.8;
        let n = 0;
        while (acc >= 1 && !battle.done && n++ < 8) {
          battle.step();
          acc -= 1;
          view.pushEvents(battle.events);
        }
        view.drawBattle(battle, dt);
        if (battle.done) {
          endTimer += dt;
          if (endTimer > 2.5) newScene();
        }
      } else {
        view.drawBoard(idle, { showZone: false }, now / 1000);
      }
    } catch (e) {
      console.warn('menu background', e);
      cancelAnimationFrame(raf);
    }
  };

  const ro = new ResizeObserver(() => view?.resize());
  ro.observe(canvas);
  let gone = false;
  raf = requestAnimationFrame(() => {
    if (gone) return;
    view?.resize();
    newScene();
    raf = requestAnimationFrame(frame);
  });

  return {
    el,
    destroy() {
      offSession();
      gone = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      view?.destroy();
    },
  };
}
