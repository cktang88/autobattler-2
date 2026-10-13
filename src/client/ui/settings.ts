// Settings: volumes, default battle speed, garage reset.

import { h, type App, type Screen } from '../app.ts';
import { playMusic, setVolumes, sfx } from '../audio.ts';
import { loadSettings, saveDeckIds, saveDesigns, saveSettings, type Settings } from '../storage.ts';
import { STARTER_DESIGNS } from '../../shared/starters.ts';
import { DECK_SIZE } from '../../shared/match.ts';
import { confirmModal } from './match-ui.ts';

export function settingsScreen(app: App): Screen {
  playMusic('menu');
  const s: Settings = loadSettings();
  const apply = () => {
    setVolumes({ master: s.master, music: s.music, sfx: s.sfx });
    saveSettings(s);
  };

  const slider = (key: 'master' | 'music' | 'sfx', label: string) => {
    const out = h('output', null, `${Math.round(s[key] * 100)}`);
    const input = h('input', { type: 'range', min: 0, max: 100, step: 1, value: Math.round(s[key] * 100), 'aria-label': label });
    input.addEventListener('input', () => {
      s[key] = Number(input.value) / 100;
      out.textContent = input.value;
      apply();
    });
    input.addEventListener('change', () => sfx('click'));
    return h('div.setting', null, h('label', null, label), input, out);
  };

  const speeds = [1, 2, 4];
  const speedBtns = speeds.map((v) => h('button', {
    onclick: () => {
      sfx('click');
      s.battleSpeed = v;
      saveSettings(s);
      speedBtns.forEach((b, i) => b.classList.toggle('active', speeds[i] === v));
    },
  }, `${v}×`));
  speedBtns.forEach((b, i) => b.classList.toggle('active', speeds[i] === s.battleSpeed));

  const reset = async () => {
    sfx('click');
    const ok = await confirmModal('Reset garage?', 'This deletes ALL your custom designs and restores the starter designs and deck. This cannot be undone.', 'Reset', true);
    if (!ok) return;
    saveDesigns(STARTER_DESIGNS.map((d) => structuredClone(d)));
    saveDeckIds(STARTER_DESIGNS.slice(0, DECK_SIZE).map((d) => d.id));
    app.toast('Garage reset to starter designs.', 'good');
  };

  const el = h('div.screen', null,
    h('div.topbar', null,
      h('button.icon', { onclick: () => { sfx('click'); app.go({ name: 'menu' }); }, title: 'Back' }, '‹ Back'),
      h('h2', null, 'Settings'),
    ),
    h('div.screen-scroll.grow', null,
      h('div.page', { style: { maxWidth: '620px' } },
        h('div.panel', null,
          h('div.panel-title', null, 'Audio'),
          slider('master', 'Master'),
          slider('music', 'Music'),
          slider('sfx', 'Effects'),
        ),
        h('div.panel', null,
          h('div.panel-title', null, 'Gameplay'),
          h('div.row', { style: { justifyContent: 'space-between', flexWrap: 'wrap' } },
            h('span', null, 'Default battle speed'),
            h('div.seg', null, ...speedBtns),
          ),
        ),
        h('div.panel', null,
          h('div.panel-title', null, 'Data'),
          h('div.row', { style: { justifyContent: 'space-between', flexWrap: 'wrap' } },
            h('span', null, 'Restore the starter designs and deck'),
            h('button.danger', { onclick: reset }, 'Reset garage'),
          ),
        ),
        h('div.panel.credits', null,
          h('div.panel-title', null, 'Credits'),
          h('p.muted', null, 'Music: Eric Skiff — We\u2019re all under the stars / Searching / Underclocked (underunderclocked mix) / We\u2019re the Resistors — Resistor Anthems — EricSkiff.com/music (CC BY 4.0).'),
          h('p.muted', null, '\u201cIn a Heartbeat\u201d Kevin MacLeod (incompetech.com), licensed under Creative Commons: By Attribution 3.0.'),
          h('p.muted', null, 'Fonts: Barlow by Jeremy Tribby (SIL OFL). Effect textures: Zero-K (public domain). Weapon ideas inspired by Zero-K.'),
        ),
      ),
    ),
  );
  return { el };
}
